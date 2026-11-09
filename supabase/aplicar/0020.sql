-- Cópia de supabase/migrations/0020_retorno_cliente.sql para o banco remoto (depois da 0019). Pode ser reaplicado sem efeito.
-- Publique antes o outbox-worker que chama schedule_reactivation (supabase/functions/_shared/whatsapp-outbox.ts).
--   ! supabase db query --remote --yes -f supabase/aplicar/0020.sql
-- Conferir depois, só leitura (esperado: true | true | true):
--   ! supabase db query --remote --read-only "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='barbershops' and column_name='msg_retorno') as colunas, to_regprocedure('public.save_return_settings(uuid, boolean, integer, text, text)') is not null as salvar, position('msg_retorno' in pg_get_functiondef('public.claim_whatsapp_outbox(integer)'::regprocedure)) > 0 as claim"
begin;

-- Barberia AI — migração 0020: mensagem de retorno do cliente (configurável por barbearia)
-- Um assunto só: quando o cliente fica um tempo sem voltar (N dias, semanas ou meses depois do último atendimento concluído),
-- a barbearia envia uma mensagem pelo WhatsApp, com texto editável (variáveis, inclusive {periodo}).
-- Regras: só para quem aceitou receber novidades (customer_consents.marketing); nunca se já houver horário marcado;
-- uma mensagem por ausência (chave = barbearia + cliente + último atendimento); só dentro de 7 dias depois do prazo,
-- para que ligar a função não dispare para todos os clientes antigos de uma vez. Começa DESLIGADO em todas as barbearias.
-- O worker (n8n a cada minuto, escopo confirmacoes_lembretes) agenda por schedule_reactivation e entrega por claim_whatsapp_outbox.
-- Depende da 0019 (textos editáveis). APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'barbershops' and column_name = 'msg_lembrete') then
    raise exception '0020 depende da 0019 (barbershops.msg_lembrete)';
  end if;
end;
$$;

alter table public.barbershops
  add column if not exists retorno_ativo boolean not null default false,
  add column if not exists retorno_quantidade smallint not null default 1,
  add column if not exists retorno_unidade text not null default 'meses',
  add column if not exists msg_retorno text not null default E'👋 Olá, {nome}! Sentimos sua falta na {barbearia}.\n\n✂️ Último atendimento: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n\nJá faz {periodo}. Que tal agendar o próximo horário?\n\nSe não quiser mais receber estas mensagens, é só responder avisando.';

alter table public.barbershops drop constraint if exists barbershops_retorno_valido;
alter table public.barbershops add constraint barbershops_retorno_valido check (
  retorno_unidade in ('dias', 'semanas', 'meses')
  and retorno_quantidade >= 1
  and retorno_quantidade <= case retorno_unidade when 'dias' then 365 when 'semanas' then 52 else 24 end
  and length(btrim(msg_retorno)) between 1 and 1000
);

comment on column public.barbershops.retorno_ativo is 'Envia a mensagem de retorno quando o cliente fica retorno_quantidade retorno_unidade sem voltar.';
comment on column public.barbershops.msg_retorno is 'Texto da mensagem de retorno (WhatsApp), com variáveis {nome}, {servico}, {data}, {periodo}...';

--------------------------------------------------------------
-- "3 meses", "1 semana", "10 dias"
--------------------------------------------------------------
create or replace function private.retorno_periodo(p_quantidade integer, p_unidade text)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_quantidade || ' ' || case p_unidade
    when 'dias' then case when p_quantidade = 1 then 'dia' else 'dias' end
    when 'semanas' then case when p_quantidade = 1 then 'semana' else 'semanas' end
    else case when p_quantidade = 1 then 'mês' else 'meses' end
  end
$$;

create or replace function private.retorno_intervalo(p_quantidade integer, p_unidade text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_unidade
    when 'dias' then make_interval(days => p_quantidade)
    when 'semanas' then make_interval(weeks => p_quantidade)
    else make_interval(months => p_quantidade)
  end
$$;

revoke all on function private.retorno_periodo(integer, text), private.retorno_intervalo(integer, text) from public, anon, authenticated;

--------------------------------------------------------------
-- save_return_settings: só a gestão; texto opcional (null mantém o atual)
--------------------------------------------------------------
create or replace function public.save_return_settings(p_barbershop_id uuid, p_ativo boolean, p_quantidade integer, p_unidade text, p_texto text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_max integer := case p_unidade when 'dias' then 365 when 'semanas' then 52 else 24 end;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ativo is null or p_unidade is null or p_unidade not in ('dias', 'semanas', 'meses') or p_quantidade is null or p_quantidade < 1
     or p_quantidade > v_max or (v_texto is not null and length(v_texto) > 1000) then
    raise exception 'invalid_return' using errcode = 'P0001';
  end if;
  update public.barbershops
  set retorno_ativo = p_ativo, retorno_quantidade = p_quantidade, retorno_unidade = p_unidade,
      msg_retorno = coalesce(v_texto, msg_retorno)
  where id = p_barbershop_id;
end;
$$;

revoke all on function public.save_return_settings(uuid, boolean, integer, text, text) from public, anon;
grant execute on function public.save_return_settings(uuid, boolean, integer, text, text) to authenticated;

--------------------------------------------------------------
-- schedule_reactivation (0006): agora pela configuração de cada barbearia
--   Último atendimento concluído do cliente na barbearia; prazo = retorno_intervalo; janela de 7 dias depois do prazo.
--   tipo 'reativacao_<dias>' (o claim_outbox já cancela reativação sem consentimento de novidades: 'opt_out').
--------------------------------------------------------------
create or replace function public.schedule_reactivation()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with ultimo as (
    select distinct on (b.barbershop_id, b.customer_id)
      b.barbershop_id, b.customer_id, b.id as booking_id, b.cliente_whatsapp, b.cliente_nome, b.servico_nome,
      b.inicio, b.professional_id
    from public.bookings b
    where b.status = 'concluido' and b.customer_id is not null
    order by b.barbershop_id, b.customer_id, b.inicio desc
  )
  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
  select u.barbershop_id, u.booking_id, u.customer_id,
         'reativacao_' || (s.retorno_quantidade * case s.retorno_unidade when 'dias' then 1 when 'semanas' then 7 else 30 end),
         u.cliente_whatsapp,
         jsonb_build_object(
           'cliente', u.cliente_nome, 'servico', u.servico_nome, 'profissional', p.nome, 'inicio', u.inicio,
           'barbearia', s.nome, 'endereco', s.endereco, 'fuso', s.fuso,
           'periodo', private.retorno_periodo(s.retorno_quantidade, s.retorno_unidade)
         ),
         'retorno:' || u.barbershop_id || ':' || u.customer_id || ':' || u.booking_id
  from ultimo u
  join public.barbershops s on s.id = u.barbershop_id and s.retorno_ativo
  left join public.professionals p on p.id = u.professional_id
  join public.customer_consents c on c.barbershop_id = u.barbershop_id and c.profile_id = u.customer_id and c.marketing
  where u.inicio <= now() - private.retorno_intervalo(s.retorno_quantidade, s.retorno_unidade)
    and u.inicio > now() - private.retorno_intervalo(s.retorno_quantidade, s.retorno_unidade) - interval '7 days'
    and not exists (
      select 1 from public.bookings f
      where f.barbershop_id = u.barbershop_id and f.customer_id = u.customer_id
        and f.status in ('pendente', 'confirmado') and f.inicio > now()
    )
  on conflict (dedup_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.schedule_reactivation() from public, anon, authenticated;
grant execute on function public.schedule_reactivation() to service_role;

--------------------------------------------------------------
-- claim_whatsapp_outbox (0019) + retorno do cliente (tipos reativacao_*) com o texto msg_retorno
--------------------------------------------------------------
drop function if exists public.claim_whatsapp_outbox(integer);

create function public.claim_whatsapp_outbox(p_limit integer default 20)
returns table (id uuid, barbershop_id uuid, booking_id uuid, tipo text, destino text, payload jsonb, tentativas integer, instancia text, modelo text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 20;
  end if;
  perform private.manter_fila();

  -- retorno desligado depois de enfileirar (ou deixado pelo agendador antigo, de 30/45/60 dias): não sai
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'retorno_desativado', atualizado_em = now()
  from public.barbershops s
  where s.id = e.barbershop_id and not s.retorno_ativo
    and e.tipo like 'reativacao\_%' and e.status in ('pendente', 'bloqueado');

  return query
  with alvo as (
    select e.id
    from public.outbox_events e
    where e.status = 'pendente' and e.proximo_envio <= now() and e.canal = 'whatsapp'
      and (e.tipo = 'reserva_confirmada' or e.tipo like 'lembrete\_%' or e.tipo like 'reativacao\_%')
    order by e.proximo_envio
    limit p_limit
    for update skip locked
  ), marcado as (
    update public.outbox_events o
    set status = 'enviando', tentativas = o.tentativas + 1, atualizado_em = now()
    from alvo
    where o.id = alvo.id
    returning o.id, o.barbershop_id, o.booking_id, o.tipo, o.destino, o.payload, o.tentativas
  )
  select m.id, m.barbershop_id, m.booking_id, m.tipo, m.destino, m.payload, m.tentativas, i.evolution_instance_name,
         case when m.tipo = 'reserva_confirmada' then s.msg_confirmacao
              when m.tipo like 'reativacao\_%' then s.msg_retorno
              else s.msg_lembrete end
  from marcado m
  join public.barbershops s on s.id = m.barbershop_id
  left join public.integration_accounts i on i.barbershop_id = m.barbershop_id and i.provider = 'whatsapp';
end;
$$;

revoke all on function public.claim_whatsapp_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_outbox(integer) to service_role;

commit;
