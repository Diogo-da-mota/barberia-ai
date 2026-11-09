-- DIFERENÇA a aplicar no banco remoto (pagamento após aceitar + trava de cancelamento com pagamento).
-- Mesmo conteúdo já editado nas migrations 0005 (register_payment, cancel_booking) e 0006 (process_whatsapp_reply).
-- Só substitui 3 funções (create or replace); não altera tabelas nem dados. Rodar uma vez:
--   ! supabase db query --remote --yes -f supabase/aplicar/diferenca-pagamento.sql
begin;

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  b public.bookings%rowtype;
  v_manager boolean;
  v_window integer;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_manager := private.has_role(b.barbershop_id, array['proprietario', 'gerente']);
  if v_user is null or not (v_manager or b.customer_id = v_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if b.status not in ('pendente', 'confirmado') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  -- controle do caixa: reserva com pagamento recebido só cancela depois do estorno
  if (select coalesce(sum(p.valor_centavos), 0) from public.payments p where p.booking_id = b.id)
     - (select coalesce(sum(r.valor_centavos), 0) from public.refunds r join public.payments p2 on p2.id = r.payment_id where p2.booking_id = b.id) > 0 then
    raise exception 'has_payments' using errcode = 'P0001';
  end if;
  select cancel_window_min into v_window from public.barbershops where id = b.barbershop_id;
  if not v_manager and b.inicio - now() < make_interval(mins => v_window) then
    raise exception 'cancel_window' using errcode = 'P0001';
  end if;

  delete from public.occupancies where id = b.occupancy_id;
  update public.bookings set status = 'cancelado', occupancy_id = null where id = b.id;
  insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
  values (b.id, b.barbershop_id, v_user, 'cancelled', jsonb_build_object('por', case when v_manager then 'gestor' else 'cliente' end));
end;
$$;

create or replace function public.register_payment(
  p_booking_id uuid, p_valor_centavos integer, p_forma text, p_parcelas integer, p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  e public.payments%rowtype;
  v_liquido bigint;
  v_id uuid;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or not private.has_role(b.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0
     or p_forma is null or p_forma not in ('pix', 'dinheiro', 'debito', 'credito')
     or p_parcelas is null or p_parcelas < 1 or p_parcelas > 12 or (p_parcelas > 1 and p_forma <> 'credito')
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 120 then
    raise exception 'invalid_payment' using errcode = 'P0001';
  end if;

  select * into e from public.payments where barbershop_id = b.barbershop_id and idempotency_key = p_idempotency_key;
  if e.id is not null then
    if e.booking_id = b.id and e.valor_centavos = p_valor_centavos and e.forma = p_forma and e.parcelas = p_parcelas then
      return e.id;
    end if;
    raise exception 'idempotency_conflict' using errcode = 'P0001';
  end if;

  -- recebe-se após aceitar a reserva (confirmada) ou depois de concluída; pendente, cancelada e falta não recebem
  if b.status not in ('confirmado', 'concluido') then
    raise exception 'booking_not_payable' using errcode = 'P0001';
  end if;
  select coalesce(sum(p.valor_centavos), 0)
         - coalesce((select sum(r.valor_centavos) from public.refunds r where r.payment_id in (select id from public.payments where booking_id = b.id)), 0)
  into v_liquido
  from public.payments p where p.booking_id = b.id;
  if v_liquido + p_valor_centavos > b.preco_centavos then
    raise exception 'overpayment' using errcode = 'P0001';
  end if;

  insert into public.payments (barbershop_id, booking_id, valor_centavos, forma, parcelas, idempotency_key, registrado_por)
  values (b.barbershop_id, b.id, p_valor_centavos, p_forma, p_parcelas, p_idempotency_key, auth.uid())
  returning id into v_id;
  insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, professional_id, booking_id, ref_id)
  values (b.barbershop_id, 'pagamento', p_valor_centavos, b.professional_id, b.id, v_id);
  return v_id;
end;
$$;

create or replace function public.process_whatsapp_reply(
  p_event_id text, p_ts timestamptz, p_from text, p_context_message_id text, p_texto text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_provider constant text := 'whatsapp';
  v_inbound uuid;
  v_texto text := translate(lower(btrim(coalesce(p_texto, ''))), 'ãáâàéêíóôõúç', 'aaaaeeiooouc');
  v_fone text := right(regexp_replace(coalesce(p_from, ''), '\D', '', 'g'), 10);
  v_out public.outbox_events%rowtype;
  b public.bookings%rowtype;
  v_window integer;
  v_status text := 'ignorado';
  v_motivo text;
  v_n integer;
begin
  if (select count(*) from public.inbound_webhook_events
      where provider = c_provider and recebido_em > now() - interval '1 minute') >= 300 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.inbound_webhook_events (provider, event_id, ts_evento)
  values (c_provider, p_event_id, p_ts)
  on conflict (provider, event_id) do nothing
  returning id into v_inbound;
  if v_inbound is null then
    return 'duplicado';
  end if;

  if p_ts is null or p_ts < now() - interval '5 minutes' or p_ts > now() + interval '1 minute' then
    update public.inbound_webhook_events set status = 'rejeitado', motivo = 'replay' where id = v_inbound;
    return 'rejeitado';
  end if;

  if length(v_fone) < 10 then
    update public.inbound_webhook_events set motivo = 'telefone_invalido' where id = v_inbound;
    return 'ignorado';
  end if;

  if v_texto = 'parar' then
    insert into public.phone_blocklist (telefone) values (v_fone) on conflict do nothing;
    v_n := 0;
    perform private.apply_marketing_consent(x.barbershop_id, x.customer_id, false, 'whatsapp')
    from (select distinct barbershop_id, customer_id from public.bookings where right(cliente_whatsapp, 10) = v_fone) x;
    get diagnostics v_n = row_count;
    update public.inbound_webhook_events set status = 'processado', motivo = 'opt_out' where id = v_inbound;
    return 'processado';
  end if;

  if v_texto not in ('sim', 'nao') then
    update public.inbound_webhook_events set motivo = 'resposta_invalida' where id = v_inbound;
    return 'ignorado';
  end if;

  -- correlação: a resposta precisa citar uma mensagem que NÓS enviamos para esta reserva
  select o.* into v_out
  from public.notification_logs l
  join public.outbox_events o on o.id = l.outbox_id
  where l.provider_message_id = p_context_message_id and l.status = 'enviado'
    and o.tipo in ('reserva_criada', 'reserva_reagendada', 'lembrete_24h', 'lembrete_2h')
  limit 1;
  if v_out.id is null or v_out.booking_id is null then
    update public.inbound_webhook_events set motivo = 'sem_correlacao' where id = v_inbound;
    return 'ignorado';
  end if;

  select * into b from public.bookings where id = v_out.booking_id for update;
  update public.inbound_webhook_events set barbershop_id = b.barbershop_id, booking_id = b.id where id = v_inbound;
  if right(b.cliente_whatsapp, 10) <> v_fone then
    update public.inbound_webhook_events set motivo = 'telefone_divergente' where id = v_inbound;
    return 'ignorado';
  end if;
  if (v_out.payload ->> 'inicio')::timestamptz is distinct from b.inicio then
    update public.inbound_webhook_events set motivo = 'desatualizado' where id = v_inbound;
    return 'ignorado';
  end if;
  if b.status not in ('pendente', 'confirmado') then
    update public.inbound_webhook_events set motivo = 'estado_final' where id = v_inbound;
    return 'ignorado';
  end if;

  if v_texto = 'sim' then
    if b.status = 'confirmado' then
      update public.inbound_webhook_events set motivo = 'ja_confirmado' where id = v_inbound;
      return 'ignorado';
    end if;
    update public.bookings set status = 'confirmado' where id = b.id;
    insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
    values (b.id, b.barbershop_id, null, 'status', jsonb_build_object('de', b.status, 'para', 'confirmado', 'via', 'whatsapp'));
  else
    select cancel_window_min into v_window from public.barbershops where id = b.barbershop_id;
    if b.inicio - now() < make_interval(mins => v_window) then
      update public.inbound_webhook_events set motivo = 'fora_da_janela' where id = v_inbound;
      return 'ignorado';
    end if;
    -- reserva com pagamento recebido não é cancelada por resposta de WhatsApp: a gestão estorna antes
    if (select coalesce(sum(p.valor_centavos), 0) from public.payments p where p.booking_id = b.id)
       - (select coalesce(sum(r.valor_centavos), 0) from public.refunds r join public.payments p2 on p2.id = r.payment_id where p2.booking_id = b.id) > 0 then
      update public.inbound_webhook_events set motivo = 'com_pagamento' where id = v_inbound;
      return 'ignorado';
    end if;
    delete from public.occupancies where id = b.occupancy_id;
    update public.bookings set status = 'cancelado', occupancy_id = null where id = b.id;
    insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
    values (b.id, b.barbershop_id, null, 'cancelled', jsonb_build_object('por', 'whatsapp'));
  end if;
  update public.inbound_webhook_events set status = 'processado', motivo = v_texto where id = v_inbound;
  return 'processado';
end;
$$;

commit;
