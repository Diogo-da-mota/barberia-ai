-- Diferença do reagendamento para um banco já com as migrations anteriores aplicadas.
-- Aplica somente funções e seus privilégios. As reservas e a fila existentes são preservadas.

begin;

-- 0003_agenda

create or replace function public.get_slot_grid(p_barbershop_id uuid, p_service_id uuid, p_data date, p_booking_id uuid default null)
returns table (prof_id uuid, prof_nome text, slot_inicio timestamptz, livre boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_dur integer;
  v_propria uuid;
begin
  select b.fuso into v_tz from public.barbershops b where b.id = p_barbershop_id and b.status = 'ativo';
  if p_booking_id is not null then
    select bk.duracao_min, bk.occupancy_id into v_dur, v_propria from public.bookings bk
    where bk.id = p_booking_id and bk.barbershop_id = p_barbershop_id and bk.service_id = p_service_id
      and bk.status in ('pendente', 'confirmado') and bk.inicio > now()
      and (bk.customer_id = auth.uid() or private.has_role(p_barbershop_id, array['proprietario', 'gerente']));
  end if;
  if v_dur is null then
    select sv.duracao_min into v_dur from public.services sv where sv.id = p_service_id and sv.barbershop_id = p_barbershop_id and sv.ativo;
  end if;
  if v_tz is null or v_dur is null or p_data is null
     or p_data < (now() at time zone v_tz)::date or p_data > (now() at time zone v_tz)::date + 60 then
    return;
  end if;
  return query
  select pr.id, pr.nome, gs, not exists (
      select 1 from public.occupancies o
      where o.professional_id = pr.id and o.id is distinct from v_propria
        and o.periodo && tstzrange(gs, gs + make_interval(mins => v_dur), '[)')
    )
  from public.professionals pr
  join public.professional_services ps on ps.professional_id = pr.id and ps.service_id = p_service_id
  join public.working_hours wh on wh.professional_id = pr.id and wh.dow = extract(dow from p_data)::int
  cross join lateral generate_series(
    (p_data::timestamp + make_interval(mins => wh.inicio_min)) at time zone v_tz,
    (p_data::timestamp + make_interval(mins => wh.fim_min - v_dur)) at time zone v_tz,
    interval '15 minutes'
  ) gs
  where pr.barbershop_id = p_barbershop_id
    and pr.ativo
    and wh.fim_min - wh.inicio_min >= v_dur
    and gs >= now()
  order by gs, pr.nome;
end;
$$;

revoke all on function public.get_slot_grid(uuid, uuid, date, uuid) from public, anon;
grant execute on function public.get_slot_grid(uuid, uuid, date, uuid) to anon, authenticated;

create or replace function public.reschedule_booking(p_booking_id uuid, p_novo_inicio timestamptz, p_professional_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  b public.bookings%rowtype;
  v_manager boolean;
  v_tz text;
  v_cand record;
  v_occ uuid;
  v_prof uuid;
  v_fim timestamptz;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_manager := private.has_role(b.barbershop_id, array['proprietario', 'gerente']);
  if v_user is null or (not v_manager and b.customer_id is distinct from v_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_request_id is not null and exists (
    select 1 from public.booking_events e where e.booking_id = b.id and e.tipo = 'rescheduled'
      and e.actor_id = v_user and e.detalhes ->> 'request_id' = p_request_id::text
  ) then
    return;
  end if;
  if b.status not in ('pendente', 'confirmado') or b.service_id is null then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if b.inicio <= clock_timestamp() then
    raise exception 'booking_started' using errcode = 'P0001';
  end if;
  if p_novo_inicio = b.inicio and coalesce(p_professional_id, b.professional_id) = b.professional_id then
    return;
  end if;
  select fuso into v_tz from public.barbershops where id = b.barbershop_id;

  delete from public.occupancies where id = b.occupancy_id;

  v_fim := p_novo_inicio + make_interval(mins => b.duracao_min);
  for v_cand in
    select s.prof_id from private.slots(b.barbershop_id, b.service_id, p_professional_id,
      (p_novo_inicio at time zone v_tz)::date, b.duracao_min) s
    where s.slot_inicio = p_novo_inicio
    order by s.prof_nome, s.prof_id
  loop
    begin
      insert into public.occupancies (barbershop_id, professional_id, kind, periodo, criado_por)
      values (b.barbershop_id, v_cand.prof_id, 'booking', tstzrange(p_novo_inicio, v_fim, '[)'), v_user)
      returning id into v_occ;
      v_prof := v_cand.prof_id;
      exit;
    exception when exclusion_violation then
      continue;
    end;
  end loop;

  if v_prof is null or p_novo_inicio <= clock_timestamp() then
    raise exception 'slot_taken' using errcode = '23P01';
  end if;
  if b.inicio <= clock_timestamp() then
    raise exception 'booking_started' using errcode = 'P0001';
  end if;

  update public.bookings set professional_id = v_prof, inicio = p_novo_inicio, fim = v_fim, occupancy_id = v_occ where id = b.id;
  insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
  values (b.id, b.barbershop_id, v_user, 'rescheduled', jsonb_build_object(
    'de', b.inicio, 'para', p_novo_inicio, 'profissional_de', b.professional_id, 'profissional_para', v_prof, 'request_id', p_request_id
  ));
end;
$$;

revoke all on function public.reschedule_booking(uuid, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reschedule_booking(uuid, timestamptz, uuid, uuid) to authenticated;

create or replace function public.reschedule_booking(p_booking_id uuid, p_novo_inicio timestamptz, p_professional_id uuid)
returns void
language sql
set search_path = ''
as $$
  select public.reschedule_booking(p_booking_id, p_novo_inicio, p_professional_id, null)
$$;

-- 0018_fila_whatsapp

create or replace function private.manter_fila()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A Evolution não oferece chave idempotente no envio de texto. Se a confirmação pode ter saído,
  -- finaliza a tentativa como incerta para impedir que uma nova execução duplique a mensagem.
  update public.outbox_events
  set status = case when tipo = 'reserva_reagendada' and max_tentativas = 1 then 'falhou' else 'pendente' end,
      ultimo_erro = case when tipo = 'reserva_reagendada' and max_tentativas = 1 then 'envio_incerto' else ultimo_erro end,
      atualizado_em = now()
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
  perform private.manter_fila();

  return query
  update public.outbox_events set status = 'enviando', tentativas = tentativas + 1, atualizado_em = now()
  where id in (
    select id from public.outbox_events
    where status = 'pendente' and proximo_envio <= now()
      and not (canal = 'whatsapp' and tipo = 'reserva_reagendada' and max_tentativas = 1)
    order by proximo_envio
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

-- 0020_retorno_cliente

create or replace function public.claim_whatsapp_outbox(p_limit integer default 20)
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
      and (e.tipo = 'reserva_confirmada' or e.tipo like 'lembrete\_%' or e.tipo like 'reativacao\_%'
        or (e.tipo = 'reserva_reagendada' and e.max_tentativas = 1))
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
              when m.tipo like 'lembrete\_%' then s.msg_lembrete end
  from marcado m
  join public.barbershops s on s.id = m.barbershop_id
  left join public.integration_accounts i on i.barbershop_id = m.barbershop_id and i.provider = 'whatsapp';
end;
$$;

-- 0021_limite_reservas

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
  v_limite boolean;
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
  -- Teto: 8 avisos de reserva por número em 24 h, somando todas as barbearias e formatos do mesmo telefone.
  -- Acima disso a reserva vale, mas o aviso não sai (motivo 'limite_telefone'). Só vale para ações do próprio cliente
  -- da reserva: confirmação/reagendamento feitos pela equipe ou pelo sistema (resposta SIM) sempre saem.
  v_limite := v_consent and new.actor_id = b.customer_id
    and v_tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_cancelada', 'reserva_reagendada') and (
    select count(*) from public.outbox_events o
    where o.canal = 'whatsapp' and o.criado_em > now() - interval '24 hours' and o.status <> 'cancelado'
      and o.tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_cancelada', 'reserva_reagendada')
      and private.br_phone_key(o.destino) = private.br_phone_key(b.cliente_whatsapp)
  ) >= 8;

  if v_tipo in ('reserva_cancelada', 'reserva_reagendada') then
    update public.outbox_events
    set status = 'cancelado', ultimo_erro = v_tipo, atualizado_em = now()
    where booking_id = b.id and status in ('pendente', 'bloqueado')
      and (v_tipo = 'reserva_cancelada' or canal = 'whatsapp')
      and (tipo like 'lembrete%' or tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_reagendada')
        or (v_tipo = 'reserva_cancelada' and tipo = 'calendar_upsert'));
  end if;

  if v_tipo <> 'reserva_confirmada' then
    insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key, status, ultimo_erro, max_tentativas)
    values (
      b.barbershop_id, b.id, b.customer_id, v_tipo, b.cliente_whatsapp, v_payload,
      b.id || ':' || v_tipo || ':' || new.id,
      case when v_limite then 'cancelado' when v_consent then 'pendente' else 'cancelado' end,
      case when v_limite then 'limite_telefone' when v_consent then null else 'sem_consentimento' end,
      case when v_tipo = 'reserva_reagendada' then 1 else 5 end
    )
    on conflict (dedup_key) do nothing;
  end if;

  if v_confirmar then
    insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key, status, ultimo_erro)
    values (
      b.barbershop_id, b.id, b.customer_id, 'reserva_confirmada', b.cliente_whatsapp, v_payload,
      b.id || ':reserva_confirmada',
      case when v_limite then 'cancelado' when v_consent then 'pendente' else 'cancelado' end,
      case when v_limite then 'limite_telefone' when v_consent then null else 'sem_consentimento' end
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

-- 0028_reagendamento_whatsapp

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
      and o.canal = 'whatsapp' and (o.tipo = 'reserva_criada' or o.tipo like 'lembrete\_%')
    order by l.criado_em desc
    limit 1;
  end if;

  -- correlação: a resposta precisa corresponder a uma mensagem que NÓS enviamos para esta reserva (e desta barbearia)
  select l.* into v_log
  from public.notification_logs l
  join public.outbox_events o on o.id = l.outbox_id
  where l.provider_message_id = v_contexto and l.status = 'enviado'
    and o.canal = 'whatsapp' and (o.tipo = 'reserva_criada' or o.tipo like 'lembrete\_%')
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
  if b.status not in ('pendente', 'confirmado') or b.inicio <= clock_timestamp() then
    update public.inbound_webhook_events set motivo = 'estado_final' where id = v_inbound;
    return 'ignorado';
  end if;

  -- etapa da conversa deste lembrete: a última resposta aplicada a ele (a trava da reserva acima serializa respostas simultâneas)
  select case when e.tipo = 'reagendamento' then 'encerrado' else e.detalhes ->> 'resposta' end into v_etapa
  from public.booking_events e
  where e.booking_id = b.id and e.tipo in ('presenca', 'reagendamento') and e.detalhes ->> 'outbox_id' = v_out.id::text
  order by (e.tipo = 'reagendamento') desc
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

notify pgrst, 'reload schema';
commit;
