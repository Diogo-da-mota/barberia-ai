-- Barberia AI — migração 0026: resposta do cliente pelo WhatsApp da barbearia (Evolution).
-- Um assunto só: process_whatsapp_reply passa a reconhecer as mensagens que a fila realmente envia e a resposta sem citação.
--   1) Correlação aceita reserva_confirmada e qualquer lembrete_<N>min (a 0015 só aceitava lembrete_24h/2h, que a fila não envia mais).
--   2) p_barbershop_id (opcional): a barbearia da instância Evolution que recebeu a mensagem. Com ela:
--      - a mensagem citada precisa ser desta barbearia;
--      - sem citação ("SIM" digitado), vale o último aviso enviado nas últimas 12 h para a ÚNICA reserva futura deste número
--        nesta barbearia; com duas ou mais reservas futuras não se adivinha (motivo 'ambiguo');
--      - PARAR bloqueia esta barbearia.
--   Sem p_barbershop_id (webhook da Meta), o comportamento é o da 0015.
-- Como desfazer: drop function public.process_whatsapp_reply(text, timestamptz, text, text, text, uuid) e reaplicar a função da 0015 com as permissões da 0006.
drop function if exists public.process_whatsapp_reply(text, timestamptz, text, text, text);

create function public.process_whatsapp_reply(
  p_event_id text, p_ts timestamptz, p_from text, p_context_message_id text, p_texto text, p_barbershop_id uuid default null
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
  v_fone text := private.br_phone_key(p_from);
  v_out public.outbox_events%rowtype;
  b public.bookings%rowtype;
  v_window integer;
  v_lojas uuid[];
  v_reservas uuid[];
  v_contexto text := p_context_message_id;
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

  if v_fone is null then
    update public.inbound_webhook_events set motivo = 'telefone_invalido' where id = v_inbound;
    return 'ignorado';
  end if;

  if v_texto = 'parar' then
    -- 0) a barbearia da instância que recebeu a mensagem
    if p_barbershop_id is not null then
      v_lojas := array[p_barbershop_id];
    end if;
    -- 1) a mensagem citada, se foi enviada a este número
    if v_lojas is null then
      select array[o.barbershop_id] into v_lojas
      from public.notification_logs l
      join public.outbox_events o on o.id = l.outbox_id
      where l.provider_message_id = p_context_message_id and l.status = 'enviado'
        and o.canal = 'whatsapp' and private.br_phone_key(o.destino) = v_fone
      limit 1;
    end if;
    -- 2) a última barbearia que enviou a este número
    if v_lojas is null then
      select array[o.barbershop_id] into v_lojas
      from public.notification_logs l
      join public.outbox_events o on o.id = l.outbox_id
      where l.status = 'enviado' and o.canal = 'whatsapp' and private.br_phone_key(o.destino) = v_fone
      order by l.criado_em desc
      limit 1;
    end if;
    -- 3) nenhum envio: as barbearias com reserva deste número
    if v_lojas is null then
      select array_agg(distinct r.barbershop_id) into v_lojas
      from public.bookings r
      where private.br_phone_key(r.cliente_whatsapp) = v_fone;
    end if;
    if v_lojas is null then
      update public.inbound_webhook_events set motivo = 'sem_barbearia' where id = v_inbound;
      return 'ignorado';
    end if;

    insert into public.phone_blocklist (barbershop_id, telefone)
    select loja, v_fone from unnest(v_lojas) as loja
    on conflict do nothing;
    perform private.apply_marketing_consent(x.barbershop_id, x.customer_id, false, 'whatsapp')
    from (
      select distinct r.barbershop_id, r.customer_id from public.bookings r
      where r.barbershop_id = any(v_lojas) and private.br_phone_key(r.cliente_whatsapp) = v_fone
    ) x;
    update public.inbound_webhook_events
    set status = 'processado', motivo = 'opt_out', barbershop_id = case when cardinality(v_lojas) = 1 then v_lojas[1] end
    where id = v_inbound;
    return 'processado';
  end if;

  if v_texto not in ('sim', 'nao') then
    update public.inbound_webhook_events set motivo = 'resposta_invalida' where id = v_inbound;
    return 'ignorado';
  end if;

  -- sem citação, na instância de uma barbearia: só a ÚNICA reserva futura deste número nela (nunca adivinhar entre duas)
  if p_context_message_id is null and p_barbershop_id is not null then
    select array_agg(r.id) into v_reservas
    from public.bookings r
    where r.barbershop_id = p_barbershop_id and r.status in ('pendente', 'confirmado') and r.inicio > now()
      and private.br_phone_key(r.cliente_whatsapp) = v_fone;
    if cardinality(v_reservas) > 1 then
      update public.inbound_webhook_events set barbershop_id = p_barbershop_id, motivo = 'ambiguo' where id = v_inbound;
      return 'ignorado';
    end if;
    -- o último aviso desta reserva, enviado há no máximo 12 h (um "não" solto dias depois não cancela nada)
    select l.provider_message_id into v_contexto
    from public.notification_logs l
    join public.outbox_events o on o.id = l.outbox_id
    where o.booking_id = v_reservas[1] and l.status = 'enviado' and l.provider_message_id is not null
      and l.criado_em > now() - interval '12 hours'
      and (o.tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_reagendada') or o.tipo like 'lembrete\_%')
    order by l.criado_em desc
    limit 1;
  end if;

  -- correlação: a resposta precisa corresponder a uma mensagem que NÓS enviamos para esta reserva (e desta barbearia)
  select o.* into v_out
  from public.notification_logs l
  join public.outbox_events o on o.id = l.outbox_id
  where l.provider_message_id = v_contexto and l.status = 'enviado'
    and (o.tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_reagendada') or o.tipo like 'lembrete\_%')
    and (p_barbershop_id is null or o.barbershop_id = p_barbershop_id)
  limit 1;
  if v_out.id is null or v_out.booking_id is null then
    update public.inbound_webhook_events set motivo = 'sem_correlacao' where id = v_inbound;
    return 'ignorado';
  end if;

  select * into b from public.bookings where id = v_out.booking_id for update;
  update public.inbound_webhook_events set barbershop_id = b.barbershop_id, booking_id = b.id where id = v_inbound;
  if private.br_phone_key(b.cliente_whatsapp) is distinct from v_fone then
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

revoke all on function public.process_whatsapp_reply(text, timestamptz, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.process_whatsapp_reply(text, timestamptz, text, text, text, uuid) to service_role;
