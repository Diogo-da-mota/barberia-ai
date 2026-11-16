-- Cópia de supabase/migrations/0028_reagendamento_whatsapp.sql para o banco remoto (depois da 0027). Aplicar uma vez só.
-- Aplicar ANTES de publicar a nova `evolution-webhook` (ela responde aos motivos 'reagendar' e 'nao_reagendar').
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0028.sql
-- Conferir depois, só leitura (esperado: true):
--   supabase db query --remote=hbkbdqctelembzqiptpi --read-only "select position('nao_reagendar' in prosrc) > 0 as nova from pg_proc where oid = to_regprocedure('public.process_whatsapp_reply(text, timestamptz, text, text, text, uuid)')"
begin;

-- Barberia AI — migração 0028: segunda resposta ao lembrete (reagendamento pelo WhatsApp).
-- Um assunto só: a conversa de cada lembrete passa a ter duas etapas. Mesma assinatura da 0027 (create or replace; permissões mantidas).
--   1ª resposta ao lembrete: SIM = presença confirmada (fim); NÃO = não poderá ir (pergunta se quer reagendar).
--   2ª resposta, só depois de um NÃO ao MESMO lembrete: SIM = 'reagendar' (o webhook manda o link da área do cliente);
--      NÃO = 'nao_reagendar' (desistência registrada para a equipe). Nenhuma das duas cancela ou cria reserva.
--   Depois disso, ou de um SIM, as próximas ficam 'ja_respondido'. A etapa vem do banco (inbound_webhook_events), não da memória do webhook.
--   Resposta citando uma mensagem que não está nos nossos avisos desta barbearia (ex.: a pergunta automática) vale como resposta sem citação.
-- Como desfazer: reaplicar a função da 0027 (supabase/aplicar/0027.sql).
create or replace function public.process_whatsapp_reply(
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
  v_log public.notification_logs%rowtype;
  v_etapa text;
  v_motivo text;
  b public.bookings%rowtype;
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
  -- citou algo que não é aviso nosso desta barbearia (ex.: a pergunta automática "Gostaria de reagendar?"): trata como sem citação
  if p_barbershop_id is not null and (p_context_message_id is null or not exists (
    select 1 from public.notification_logs l join public.outbox_events o on o.id = l.outbox_id
    where l.provider_message_id = p_context_message_id and o.barbershop_id = p_barbershop_id
  )) then
    select array_agg(r.id) into v_reservas
    from public.bookings r
    where r.barbershop_id = p_barbershop_id and r.status in ('pendente', 'confirmado') and r.inicio > now()
      and private.br_phone_key(r.cliente_whatsapp) = v_fone;
    if cardinality(v_reservas) > 1 then
      update public.inbound_webhook_events set barbershop_id = p_barbershop_id, motivo = 'ambiguo' where id = v_inbound;
      return 'ignorado';
    end if;
    -- o último aviso desta reserva que pede SIM/NÃO, enviado há no máximo 12 h (um "não" solto dias depois não vale)
    select l.provider_message_id into v_contexto
    from public.notification_logs l
    join public.outbox_events o on o.id = l.outbox_id
    where o.booking_id = v_reservas[1] and l.status = 'enviado' and l.provider_message_id is not null
      and l.criado_em > now() - interval '12 hours'
      and (o.tipo in ('reserva_criada', 'reserva_reagendada') or o.tipo like 'lembrete\_%')
    order by l.criado_em desc
    limit 1;
  end if;

  -- correlação: a resposta precisa corresponder a uma mensagem que NÓS enviamos para esta reserva (e desta barbearia)
  select l.* into v_log
  from public.notification_logs l
  join public.outbox_events o on o.id = l.outbox_id
  where l.provider_message_id = v_contexto and l.status = 'enviado'
    and (o.tipo in ('reserva_criada', 'reserva_reagendada') or o.tipo like 'lembrete\_%')
    and (p_barbershop_id is null or o.barbershop_id = p_barbershop_id)
  limit 1;
  select * into v_out from public.outbox_events where id = v_log.outbox_id;
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

  -- etapa da conversa deste lembrete: a última resposta aplicada a ele (a trava da reserva acima serializa respostas simultâneas)
  select e.motivo into v_etapa
  from public.inbound_webhook_events e
  where e.booking_id = b.id and e.id <> v_inbound and e.status = 'processado'
    and e.motivo in ('sim', 'nao', 'reagendar', 'nao_reagendar') and e.recebido_em >= v_log.criado_em
  order by e.recebido_em desc
  limit 1;

  if v_etapa is null then
    v_motivo := v_texto; -- 1ª resposta: sim | nao
    if v_texto = 'sim' and b.status = 'pendente' then
      update public.bookings set status = 'confirmado' where id = b.id;
      insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
      values (b.id, b.barbershop_id, null, 'status', jsonb_build_object('de', b.status, 'para', 'confirmado', 'via', 'whatsapp'));
    end if;
    -- presença: SIM vai, NÃO não pode ir (a reserva continua; a gestão reagenda ou cancela)
    insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
    values (b.id, b.barbershop_id, null, 'presenca', jsonb_build_object('resposta', v_texto, 'via', 'whatsapp', 'outbox_id', v_out.id));
  elsif v_etapa = 'nao' then
    -- 2ª resposta, à pergunta "Gostaria de reagendar?": nada muda na reserva até o cliente concluir o reagendamento
    v_motivo := case when v_texto = 'sim' then 'reagendar' else 'nao_reagendar' end;
    insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
    values (b.id, b.barbershop_id, null, 'reagendamento', jsonb_build_object('resposta', v_texto, 'via', 'whatsapp', 'outbox_id', v_out.id));
  else
    update public.inbound_webhook_events set motivo = 'ja_respondido' where id = v_inbound;
    return 'ignorado';
  end if;
  update public.inbound_webhook_events set status = 'processado', motivo = v_motivo where id = v_inbound;
  return 'processado';
end;
$$;


commit;
