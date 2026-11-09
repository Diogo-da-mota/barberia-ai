-- DIFERENÇA a aplicar no banco remoto: fecha a fila de confirmação e lembretes (0017).
-- Estado lido do remoto em 2026-11-07 (somente leitura): a coluna barbershops.reminder_config e o save_site_profile com
-- p_reminder_config já existem; schedule_reminders é um rascunho antigo da 0017; claim_outbox é o da 0015;
-- release_blocked_outbox é o da 0006; o gatilho private.enqueue_booking_event é o da 0009.
--
-- O que muda (igual a supabase/migrations/0017_reminder_config.sql):
--   1. private.lembrete_prazo / private.lembrete_vencido: janela única do lembrete, igual para 15, 30, 60 e 120 min:
--      abre na antecedência configurada (início - antecedência) e fecha no início do atendimento.
--   2. schedule_reminders: chave sem a antecedência (trocar 30/60/120/15 reaproveita a mesma linha, sem duplicar) e a janela acima.
--   3. claim_outbox: descarta lembrete com a janela fechada; cancela lembrete/confirmação que ainda não saiu se a barbearia desligou.
--   4. release_blocked_outbox (reconectar): descarta lembrete com a janela fechada em vez de liberá-lo.
--   5. enqueue_booking_event: exatamente uma reserva_confirmada por reserva (chave "<reserva>:reserva_confirmada"), quando ela
--      nasce confirmada ou quando uma pendente é aceita; nada com auto_confirmation desligada; sem consentimento, só o registro
--      cancelado ('sem_consentimento').
--   6. Dados (deduplicação sem reescrever o histórico): de cada reserva + horário com lembrete do rascunho
--      (chave "<reserva>:lembrete_<N>min:<horário>"), UM lembrete não cancelado passa para a chave nova "<reserva>:lembrete:<horário>",
--      na ordem enviado > enviando > falhou > na fila. Só a chave muda: status, tipo, payload, tentativas, datas e logs ficam
--      como estão (atualizado_em também, porque conta no limite de 12 mensagens por número em 24h). Cancelados não mudam.
--      Cópias que ainda estão na fila (pendente/bloqueado) e nunca saíram são canceladas com 'lembrete_duplicado'.
--      Lembretes antigos 24h/2h não mudam. Em 2026-11-07 o remoto tinha 0 linhas do rascunho e 0 lembretes ativos.
-- O que NÃO muda: tabelas, colunas, permissões de tabela, save_site_profile e as demais funções.
-- Pode ser reaplicado sem efeito. Testado em supabase/tests/diferenca-lembretes.test.ts.
--
-- Rodar uma vez, com autorização:
--   ! supabase db query --remote --yes -f supabase/aplicar/diferenca-lembretes.sql
--
-- Conferir depois, só leitura (esperado: true | true | true | true | 0):
--   ! supabase db query --remote --read-only "select to_regprocedure('private.lembrete_vencido(jsonb)') is not null as janela, position(':lembrete:' in pg_get_functiondef('public.schedule_reminders()'::regprocedure)) > 0 as agendador, position('lembrete_vencido' in pg_get_functiondef('public.release_blocked_outbox(uuid)'::regprocedure)) > 0 as reconectar, position('auto_confirmation' in pg_get_functiondef('private.enqueue_booking_event()'::regprocedure)) > 0 as confirmacao, (select count(*) from public.outbox_events where dedup_key ~ ':lembrete_[0-9]+min:[0-9]+$' and status in ('pendente', 'bloqueado')) as rascunho_na_fila"
begin;

do $$
begin
  if to_regprocedure('private.br_phone_key(text)') is null or to_regclass('public.calendar_connections') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'barbershops' and column_name = 'reminder_config') then
    raise exception 'diferenca-lembretes exige 0009, 0015 e a coluna reminder_config da 0017';
  end if;
end;
$$;

--------------------------------------------------------------
-- Janela do lembrete (regra única: agendador, fila e reconexão usam estas funções)
--   Igual para 15, 30, 60 e 120 min: abre na antecedência configurada (início - antecedência) e fecha no início do atendimento.
--   Agendador atrasado ainda gera e o worker ainda envia enquanto a janela estiver aberta; do início em diante, nunca.
--   Sem antecedência no payload (lembretes antigos 24h/2h): a janela só tem o fim, o início do atendimento.
--------------------------------------------------------------
create or replace function private.lembrete_prazo(p_inicio timestamptz, p_lead_min integer)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(p_inicio - make_interval(mins => p_lead_min), p_inicio, '[)')
$$;

create or replace function private.lembrete_vencido(p_payload jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select now() >= upper(private.lembrete_prazo((p_payload ->> 'inicio')::timestamptz, (p_payload ->> 'lead_time_minutes')::integer))
$$;

revoke all on function private.lembrete_prazo(timestamptz, integer), private.lembrete_vencido(jsonb) from public, anon, authenticated;

--------------------------------------------------------------
-- schedule_reminders: um lembrete por reserva + horário, com a antecedência da barbearia
--   Janela: private.lembrete_prazo, de (início - antecedência) até o início. Agendador atrasado ainda gera; do início em diante, não.
--   A antecedência não entra na chave: mudar de 60 para 30 reaproveita a mesma linha da fila, nunca cria outra.
--   O horário entra na chave: reagendar gera o lembrete do novo horário, mesmo que o anterior já tenha saído.
--   Só o que ainda não saiu muda. Enviando, enviado e falhou ficam como estão (sem envio duplo nem histórico reescrito).
--------------------------------------------------------------
create or replace function public.schedule_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_i integer;
  v_tipo text;
  v_envio timestamptz;
  v_janela tstzrange;
  v_chave text;
  v_payload jsonb;
  r record;
begin
  for r in
    select b.id as booking_id, b.barbershop_id, b.customer_id, b.cliente_nome, b.cliente_whatsapp,
           b.servico_nome, b.inicio, b.fim,
           p.nome as prof_nome,
           s.fuso, s.nome as shop_nome, s.endereco,
           (s.reminder_config ->> 'lead_time_minutes')::int as lead_min
    from public.bookings b
    join public.professionals p on p.id = b.professional_id
    join public.barbershops s on s.id = b.barbershop_id
    where b.status = 'confirmado'
      and b.consent_lembretes
      and b.inicio > now()
      and s.reminder_config -> 'auto_reminder' = 'true'::jsonb
  loop
    v_tipo := 'lembrete_' || r.lead_min || 'min';
    v_envio := r.inicio - make_interval(mins => r.lead_min);
    v_janela := private.lembrete_prazo(r.inicio, r.lead_min);
    v_chave := r.booking_id || ':lembrete:' || extract(epoch from r.inicio)::bigint;
    v_payload := jsonb_build_object(
      'booking_id', r.booking_id, 'cliente', r.cliente_nome, 'servico', r.servico_nome,
      'profissional', r.prof_nome, 'inicio', r.inicio, 'fim', r.fim,
      'fuso', r.fuso, 'barbearia', r.shop_nome, 'endereco', r.endereco,
      'lead_time_minutes', r.lead_min
    );
    -- Antecedência nova, ou reserva que voltou ao horário antigo: reaproveita a linha que já está na fila
    update public.outbox_events e
    set tipo = v_tipo,
        payload = v_payload,
        proximo_envio = v_envio,
        status = case when e.status = 'cancelado' then 'pendente' else e.status end,
        ultimo_erro = case when e.status = 'cancelado' then null else e.ultimo_erro end,
        atualizado_em = now()
    where e.dedup_key = v_chave
      and (
        (e.status in ('pendente', 'bloqueado') and e.tipo <> v_tipo)
        or (e.status = 'cancelado' and e.ultimo_erro = 'reserva_reagendada')
      );
    get diagnostics v_i = row_count;
    v_n := v_n + v_i;

    if now() <@ v_janela then
      insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
      values (r.barbershop_id, r.booking_id, r.customer_id, v_tipo, r.cliente_whatsapp, v_payload, v_chave)
      on conflict (dedup_key) do nothing;
      get diagnostics v_i = row_count;
      v_n := v_n + v_i;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.schedule_reminders() from public, anon, authenticated;
grant execute on function public.schedule_reminders() to service_role;

--------------------------------------------------------------
-- release_blocked_outbox (reconectar o canal): lembrete com a janela fechada é descartado, não liberado
--------------------------------------------------------------
create or replace function public.release_blocked_outbox(p_barbershop_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.outbox_events e
  set status = 'cancelado',
      ultimo_erro = 'reserva_vencida',
      atualizado_em = now()
  where e.barbershop_id = p_barbershop_id and e.status = 'bloqueado'
    and e.tipo like 'lembrete%' and private.lembrete_vencido(e.payload);

  update public.outbox_events
  set status = 'pendente', ultimo_erro = null, proximo_envio = now(), atualizado_em = now()
  where barbershop_id = p_barbershop_id and status = 'bloqueado';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.release_blocked_outbox(uuid) from public, anon, authenticated;
grant execute on function public.release_blocked_outbox(uuid) to service_role;

--------------------------------------------------------------
-- Gatilho da reserva (0009): exatamente uma reserva_confirmada por reserva, com auto_confirmation ligada
--   Entra na fila quando a reserva nasce confirmada (evento created) ou quando uma pendente é aceita (status → confirmado).
--   A chave é da reserva ("<reserva>:reserva_confirmada"): nunca há uma segunda confirmação para a mesma reserva.
--   Sem consentimento, fica só o registro cancelado ('sem_consentimento'), como os demais avisos: nada é enviado.
--------------------------------------------------------------
create or replace function private.enqueue_booking_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  v_tipo text;
  v_prof text;
  v_shop public.barbershops%rowtype;
  v_consent boolean;
  v_payload jsonb;
  v_confirmar boolean;
begin
  v_tipo := case
    when new.tipo = 'created' then 'reserva_criada'
    when new.tipo = 'cancelled' then 'reserva_cancelada'
    when new.tipo = 'rescheduled' then 'reserva_reagendada'
    when new.tipo = 'status' and new.detalhes ->> 'para' = 'confirmado' then 'reserva_confirmada'
    when new.tipo = 'status' and new.detalhes ->> 'para' = 'concluido' then 'atendimento_concluido'
    else null
  end;
  if v_tipo is null then
    return new;
  end if;
  select * into b from public.bookings where id = new.booking_id;
  select nome into v_prof from public.professionals where id = b.professional_id;
  select * into v_shop from public.barbershops where id = b.barbershop_id;
  v_consent := b.consent_lembretes;
  v_confirmar := (v_tipo = 'reserva_confirmada' or (v_tipo = 'reserva_criada' and b.status = 'confirmado'))
    and v_shop.reminder_config -> 'auto_confirmation' is distinct from 'false'::jsonb;
  v_payload := jsonb_build_object(
    'booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', v_prof,
    'inicio', b.inicio, 'fim', b.fim, 'fuso', v_shop.fuso, 'barbearia', v_shop.nome, 'endereco', v_shop.endereco
  );

  if v_tipo = 'reserva_cancelada' then
    update public.outbox_events
    set status = 'cancelado', ultimo_erro = 'reserva_cancelada', atualizado_em = now()
    where booking_id = b.id and status in ('pendente', 'bloqueado')
      and (tipo like 'lembrete%' or tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_reagendada', 'calendar_upsert'));
  end if;

  if v_tipo <> 'reserva_confirmada' then
    insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key, status, ultimo_erro)
    values (
      b.barbershop_id, b.id, b.customer_id, v_tipo, b.cliente_whatsapp, v_payload,
      b.id || ':' || v_tipo || ':' || new.id,
      case when v_consent then 'pendente' else 'cancelado' end,
      case when v_consent then null else 'sem_consentimento' end
    )
    on conflict (dedup_key) do nothing;
  end if;

  if v_confirmar then
    insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key, status, ultimo_erro)
    values (
      b.barbershop_id, b.id, b.customer_id, 'reserva_confirmada', b.cliente_whatsapp, v_payload,
      b.id || ':reserva_confirmada',
      case when v_consent then 'pendente' else 'cancelado' end,
      case when v_consent then null else 'sem_consentimento' end
    )
    on conflict (dedup_key) do nothing;
  end if;

  -- agenda do profissional no Google (só se ele vinculou e consentiu)
  if v_tipo in ('reserva_criada', 'reserva_reagendada', 'reserva_cancelada')
     and exists (select 1 from public.calendar_connections where professional_id = b.professional_id and status = 'ativo') then
    insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, canal, destino, payload, dedup_key)
    values (
      b.barbershop_id, b.id, b.customer_id,
      case when v_tipo = 'reserva_cancelada' then 'calendar_delete' else 'calendar_upsert' end,
      'google_calendar', b.professional_id::text, v_payload, b.id || ':calendar:' || new.id
    )
    on conflict (dedup_key) do nothing;
  end if;
  return new;
end;
$$;

--------------------------------------------------------------
-- claim_outbox da 0015: última barreira antes do envio.
--   Lembrete com a janela fechada (do início do atendimento em diante) não sai: pendente, em nova tentativa, bloqueado ou preso em envio.
--   Configuração desligada depois de enfileirar: lembrete e confirmação que ainda não saíram são cancelados.
--------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.br_phone_key(text)') is null then
    raise exception '0017 depende da 0015 (private.br_phone_key)';
  end if;
end;
$$;

create or replace function public.claim_outbox(p_limit integer default 20)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 20;
  end if;
  update public.outbox_events set status = 'pendente', atualizado_em = now()
  where status = 'enviando' and atualizado_em < now() - interval '10 minutes';

  update public.outbox_events e
  set status = 'cancelado',
      ultimo_erro = 'reserva_vencida',
      atualizado_em = now()
  where e.tipo like 'lembrete%' and e.status in ('pendente', 'bloqueado')
    and private.lembrete_vencido(e.payload);

  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'reserva_reagendada', atualizado_em = now()
  from public.bookings b
  where b.id = e.booking_id
    and e.tipo like 'lembrete%' and e.status in ('pendente', 'bloqueado')
    and (e.payload ->> 'inicio')::timestamptz <> b.inicio;

  update public.outbox_events e
  set status = 'cancelado',
      ultimo_erro = case when e.tipo = 'reserva_confirmada' then 'confirmacao_desativada' else 'lembrete_desativado' end,
      atualizado_em = now()
  from public.barbershops s
  where s.id = e.barbershop_id and e.status in ('pendente', 'bloqueado')
    and (
      (e.tipo = 'reserva_confirmada' and s.reminder_config -> 'auto_confirmation' = 'false'::jsonb)
      or (e.tipo like 'lembrete%' and s.reminder_config -> 'auto_reminder' = 'false'::jsonb)
    );

  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'opt_out', atualizado_em = now()
  where e.status in ('pendente', 'bloqueado') and e.tipo like 'reativacao%'
    and not exists (
      select 1 from public.customer_consents c
      where c.barbershop_id = e.barbershop_id and c.profile_id = e.customer_id and c.marketing
    );

  -- número que pediu PARAR a esta barbearia não recebe nada dela (nem avisos da reserva): o titular do número pode não ser quem reservou
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'numero_bloqueado', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status in ('pendente', 'bloqueado')
    and exists (
      select 1 from public.phone_blocklist b
      where b.barbershop_id = e.barbershop_id and b.telefone = private.br_phone_key(e.destino)
    );

  -- no máximo 12 mensagens por número em 24h, por barbearia (3 reservas × 3 avisos): nenhuma vira canal de spam para terceiros nem afeta as outras
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'limite_destino', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status = 'pendente'
    and (
      select count(*) from public.outbox_events x
      where x.canal = 'whatsapp' and x.barbershop_id = e.barbershop_id
        and x.status in ('enviado', 'enviando') and x.atualizado_em > now() - interval '24 hours'
        and private.br_phone_key(x.destino) = private.br_phone_key(e.destino)
    ) >= 12;

  update public.outbox_events e
  set status = 'bloqueado', ultimo_erro = 'canal_nao_configurado', atualizado_em = now()
  where e.status = 'pendente' and e.proximo_envio <= now()
    and not exists (
      select 1 from public.integration_accounts i
      where i.barbershop_id = e.barbershop_id and i.provider = e.canal and i.status = 'ativo'
    );

  return query
  update public.outbox_events set status = 'enviando', tentativas = tentativas + 1, atualizado_em = now()
  where id in (
    select id from public.outbox_events
    where status = 'pendente' and proximo_envio <= now()
    order by proximo_envio
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

revoke all on function public.claim_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_outbox(integer) to service_role;

--------------------------------------------------------------
-- Dados: lembretes do rascunho passam para a chave nova (um por reserva + horário); só a chave muda
--------------------------------------------------------------
with rascunho as (
  select e.id,
         e.booking_id || ':lembrete:' || split_part(e.dedup_key, ':', 3) as nova,
         row_number() over (
           partition by e.booking_id, split_part(e.dedup_key, ':', 3)
           order by case e.status when 'enviado' then 0 when 'enviando' then 1 when 'falhou' then 2 else 3 end,
                    e.criado_em desc
         ) as ordem
  from public.outbox_events e
  where e.dedup_key ~ ':lembrete_[0-9]+min:[0-9]+$' and e.status <> 'cancelado'
)
update public.outbox_events e
set dedup_key = r.nova
from rascunho r
where r.id = e.id and r.ordem = 1
  and not exists (select 1 from public.outbox_events x where x.dedup_key = r.nova);

-- o que sobrou do rascunho ainda na fila é cópia que nunca saiu
update public.outbox_events
set status = 'cancelado', ultimo_erro = 'lembrete_duplicado', atualizado_em = now()
where dedup_key ~ ':lembrete_[0-9]+min:[0-9]+$' and status in ('pendente', 'bloqueado');

commit;
