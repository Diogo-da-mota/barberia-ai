-- Barberia AI — migração 0019: textos editáveis da confirmação e do lembrete
-- Um assunto só: cada barbearia escreve o próprio texto da confirmação automática e do lembrete automático, com variáveis
-- ({nome}, {cliente}, {servico}, {profissional}, {data}, {dia_semana}, {hora}, {barbearia}, {endereco}, {antecedencia}, {falta}).
-- Valor inicial = o formato com ícones (DEFAULT_TEMPLATES em supabase/functions/_shared/messages.ts).
-- O worker recebe o texto pelo claim_whatsapp_outbox (coluna `modelo`) e monta a mensagem com renderTemplate.
-- Depende da 0018 (claim_whatsapp_outbox). APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA.

do $$
begin
  if to_regprocedure('public.claim_whatsapp_outbox(integer)') is null then
    raise exception '0019 depende da 0018 (public.claim_whatsapp_outbox)';
  end if;
end;
$$;

alter table public.barbershops
  add column if not exists msg_confirmacao text not null default E'✅ Olá, {nome}! Seu agendamento está confirmado.\n\n✂️ Serviço: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n🕔 Horário: {hora}\n📍 Local: {barbearia}',
  add column if not exists msg_lembrete text not null default E'⏰ Olá, {nome}! {falta} para o seu atendimento!\n\n✂️ Serviço: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n🕔 Horário: {hora}\n📍 Local: {barbearia}';

alter table public.barbershops drop constraint if exists barbershops_msg_tamanho;
alter table public.barbershops add constraint barbershops_msg_tamanho
  check (length(btrim(msg_confirmacao)) between 1 and 1000 and length(btrim(msg_lembrete)) between 1 and 1000);

comment on column public.barbershops.msg_confirmacao is 'Texto da confirmação automática (WhatsApp), com variáveis {nome}, {servico}, {data}, {hora}...';
comment on column public.barbershops.msg_lembrete is 'Texto do lembrete automático (WhatsApp), com variáveis {nome}, {servico}, {data}, {hora}, {antecedencia}...';

--------------------------------------------------------------
-- save_message_templates: só a gestão grava; texto de 1 a 1000 caracteres (sem espaços nas pontas)
--------------------------------------------------------------
create or replace function public.save_message_templates(p_barbershop_id uuid, p_confirmacao text, p_lembrete text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmacao text := btrim(coalesce(p_confirmacao, ''));
  v_lembrete text := btrim(coalesce(p_lembrete, ''));
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_confirmacao) not between 1 and 1000 or length(v_lembrete) not between 1 and 1000 then
    raise exception 'invalid_template' using errcode = 'P0001';
  end if;
  update public.barbershops set msg_confirmacao = v_confirmacao, msg_lembrete = v_lembrete where id = p_barbershop_id;
end;
$$;

revoke all on function public.save_message_templates(uuid, text, text) from public, anon;
grant execute on function public.save_message_templates(uuid, text, text) to authenticated;

--------------------------------------------------------------
-- claim_whatsapp_outbox (0018) + coluna `modelo`: o texto da barbearia para o tipo (confirmação ou lembrete)
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

  return query
  with alvo as (
    select e.id
    from public.outbox_events e
    where e.status = 'pendente' and e.proximo_envio <= now() and e.canal = 'whatsapp'
      and (e.tipo = 'reserva_confirmada' or e.tipo like 'lembrete\_%')
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
         case when m.tipo = 'reserva_confirmada' then s.msg_confirmacao else s.msg_lembrete end
  from marcado m
  join public.barbershops s on s.id = m.barbershop_id
  left join public.integration_accounts i on i.barbershop_id = m.barbershop_id and i.provider = 'whatsapp';
end;
$$;

revoke all on function public.claim_whatsapp_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_outbox(integer) to service_role;
