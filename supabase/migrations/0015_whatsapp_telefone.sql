--------------------------------------------------------------
-- 0015: identidade do telefone e bloqueio (PARAR) por barbearia (tarefa A2 de DIAGNOSTICO_WHATSAPP_N8N.md)
-- Um assunto só: como reconhecer um número de WhatsApp e quem ele bloqueou.
--   1) private.br_phone_key(text): chave única do número, DDD + 8 últimos dígitos. Corrige dois defeitos dos "10 dígitos à direita":
--      DDDs diferentes colidiam (11 e 21 viravam a mesma chave) e o mesmo número com e sem o nono dígito virava duas chaves.
--   2) phone_blocklist passa a ser por barbearia. Continua sem nenhum acesso pela API (sem grant e sem política): só funções de servidor.
--      Bloqueios antigos são convertidos para as barbearias que têm aquele número; sem nenhuma, a migration PARA (nada é apagado às cegas).
--   3) claim_outbox: bloqueio e limite de 12 mensagens em 24h valem por barbearia. O volume de uma não cancela a mensagem de outra.
--   4) process_whatsapp_reply: mesma assinatura; PARAR só alcança a barbearia identificada e o seu consentimento de novidades.
-- Até a tarefa B3 trazer o número que recebeu a resposta (phone_number_id), a barbearia do PARAR é identificada, nesta ordem:
--   mensagem citada, se enviada a este número; última barbearia que enviou a este número; barbearias com reserva deste número.
--   Sem envio e com reservas em mais de uma barbearia, bloqueia nas duas: o pedido vem do próprio titular (assinatura HMAC) e não pode ser ignorado.
-- Como desfazer: reaplicar claim_outbox da 0009 e process_whatsapp_reply da 0006; recriar phone_blocklist como na 0006 (só telefone) e
--   drop function private.br_phone_key(text). Atenção: isso volta a colisão de DDD e perde a separação por barbearia.
--------------------------------------------------------------

--------------------------------------------------------------
-- Chave do número
--------------------------------------------------------------
-- Brasil (com ou sem 55, zero de discagem e máscara): DDD + 8 últimos dígitos, assim 11 91234-5678 e 11 1234-5678 são o mesmo número.
-- Outros países: todos os dígitos (11 a 15 dígitos, ou 10 com DDD inexistente), o que nunca coincide com uma chave brasileira válida.
-- Fixo e celular de mesmo DDD e mesmos 8 dígitos dão a mesma chave. É raro e o efeito é bloquear a mais: preferível a não bloquear quem pediu.
create function private.br_phone_key(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := ltrim(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '0');
begin
  if v ~ '^55[1-9][1-9]([0-9]{8}|9[0-9]{8})$' then
    v := substr(v, 3);
  end if;
  if v ~ '^[1-9][1-9]9[0-9]{8}$' then
    return left(v, 2) || right(v, 8);
  end if;
  if length(v) between 10 and 15 then
    return v;
  end if;
  return null;
end;
$$;
revoke all on function private.br_phone_key(text) from public, anon, authenticated;

--------------------------------------------------------------
-- Bloqueio por barbearia, convertendo o que já existe
--------------------------------------------------------------
alter table public.phone_blocklist
  drop constraint phone_blocklist_pkey,
  drop constraint phone_blocklist_telefone_check,
  add column barbershop_id uuid references public.barbershops(id) on delete cascade;

-- bloqueio antigo sem nenhuma barbearia ligada ao número: decisão humana, nada é descartado aqui
do $$
begin
  if exists (
    select 1 from public.phone_blocklist a
    where not exists (select 1 from public.outbox_events o where o.canal = 'whatsapp' and private.br_phone_key(o.destino) is not null and right(regexp_replace(o.destino, '\D', '', 'g'), 10) = a.telefone)
      and not exists (select 1 from public.bookings r where private.br_phone_key(r.cliente_whatsapp) is not null and right(regexp_replace(r.cliente_whatsapp, '\D', '', 'g'), 10) = a.telefone)
  ) then
    raise exception 'phone_blocklist_sem_barbearia' using errcode = 'P0001';
  end if;
end;
$$;

-- a chave antiga misturava DDDs: todo número que caía nela estava bloqueado e continua bloqueado, cada um na sua barbearia
insert into public.phone_blocklist (barbershop_id, telefone, criado_em)
select distinct on (v.barbershop_id, private.br_phone_key(v.fone)) v.barbershop_id, private.br_phone_key(v.fone), a.criado_em
from public.phone_blocklist a
join (
  select o.barbershop_id, o.destino as fone from public.outbox_events o where o.canal = 'whatsapp'
  union
  select r.barbershop_id, r.cliente_whatsapp from public.bookings r
) v on right(regexp_replace(v.fone, '\D', '', 'g'), 10) = a.telefone
where a.barbershop_id is null and private.br_phone_key(v.fone) is not null
order by v.barbershop_id, private.br_phone_key(v.fone), a.criado_em;

delete from public.phone_blocklist where barbershop_id is null;

alter table public.phone_blocklist
  alter column barbershop_id set not null,
  add constraint phone_blocklist_pkey primary key (barbershop_id, telefone),
  add constraint phone_blocklist_telefone_check check (telefone ~ '^[0-9]{10,15}$');

--------------------------------------------------------------
-- claim_outbox da 0009: bloqueio e limite por barbearia, com a chave nova
--------------------------------------------------------------
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

--------------------------------------------------------------
-- process_whatsapp_reply da 0006: chave nova e PARAR por barbearia. O restante não muda.
--------------------------------------------------------------
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
  v_fone text := private.br_phone_key(p_from);
  v_out public.outbox_events%rowtype;
  b public.bookings%rowtype;
  v_window integer;
  v_lojas uuid[];
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
    -- 1) a mensagem citada, se foi enviada a este número
    select array[o.barbershop_id] into v_lojas
    from public.notification_logs l
    join public.outbox_events o on o.id = l.outbox_id
    where l.provider_message_id = p_context_message_id and l.status = 'enviado'
      and o.canal = 'whatsapp' and private.br_phone_key(o.destino) = v_fone
    limit 1;
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
