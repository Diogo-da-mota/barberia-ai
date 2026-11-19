-- Barberia AI — migração 0045: reserva manual com cota por barbearia e fila do WhatsApp com revezamento entre barbearias.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0006, 0020 e 0022 (mesmas assinaturas; create or replace mantém
-- permissões). Aplicar DEPOIS de supabase/aplicar/diferenca-reagendamento.sql, que recria claim_whatsapp_outbox sem esta
-- correção. Testada em supabase/tests/reserva-manual-cota.test.ts. Nenhum dado muda.
--
-- Antes: qualquer conta cria a própria barbearia e, como gestão, chamava create_manual_booking sem limite de quantidade (o
-- teto de 10 por conta em 24 h da 0021 é do cliente, e o teto de avisos por número só vale para ações do próprio cliente);
-- cada reserva confirmada enfileira um aviso, e claim_whatsapp_outbox entregava a fila de TODAS as barbearias em ordem global de
-- proximo_envio, 20 por vez: o lote de uma barbearia atrasava as confirmações das outras e os lembretes vencidos eram cancelados.
-- Agora: (1) no máximo 300 reservas manuais por barbearia em 24 h ('manual_booking_limit'), o suficiente para o dia de uma
-- barbearia grande; (2) a fila reivindica em revezamento por barbearia, então o volume de uma não ocupa a vez das outras.

-- Índice da contagem da cota (só os eventos de criação; a tabela só tinha índice por reserva).
create index if not exists idx_booking_events_shop_created on public.booking_events (barbershop_id, criado_em) where tipo = 'created';

create or replace function public.create_manual_booking(
  p_barbershop_id uuid,
  p_service_id uuid,
  p_professional_id uuid,
  p_inicio timestamptz,
  p_nome text,
  p_whatsapp text,
  p_consent_lembretes boolean,
  p_idempotency_key text,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tz text;
  v_svc public.services%rowtype;
  v_whats text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_occ uuid;
  v_fim timestamptz;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_nome, ''))) not between 1 and 120 or length(v_whats) not between 10 and 13
     or (v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then
    raise exception 'invalid_contact' using errcode = '22023';
  end if;
  if p_professional_id is null then
    raise exception 'invalid_professional' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.bookings
    where barbershop_id = p_barbershop_id and customer_id is null and idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- Cota por barbearia: no máximo 300 reservas manuais em 24 h (cada uma pode gerar avisos na fila de WhatsApp de todos).
  perform pg_advisory_xact_lock(hashtextextended('manual_booking:' || p_barbershop_id::text, 0));
  if (select count(*) from public.booking_events
      where barbershop_id = p_barbershop_id and tipo = 'created' and detalhes ->> 'origem' = 'manual'
        and criado_em > now() - interval '24 hours') >= 300 then
    raise exception 'manual_booking_limit' using errcode = 'P0001';
  end if;

  select * into v_svc from public.services where id = p_service_id and barbershop_id = p_barbershop_id and ativo;
  select fuso into v_tz from public.barbershops where id = p_barbershop_id and status = 'ativo';
  if v_svc.id is null or v_tz is null then
    raise exception 'invalid_service' using errcode = '22023';
  end if;

  -- Mesmas regras da reserva pública: o horário precisa estar livre para este barbeiro e este serviço
  if not exists (
    select 1 from private.slots(p_barbershop_id, p_service_id, p_professional_id, (p_inicio at time zone v_tz)::date, v_svc.duracao_min) s
    where s.slot_inicio = p_inicio and s.prof_id = p_professional_id
  ) then
    raise exception 'slot_taken' using errcode = '23P01';
  end if;

  v_fim := p_inicio + make_interval(mins => v_svc.duracao_min);
  begin
    insert into public.occupancies (barbershop_id, professional_id, kind, periodo, criado_por)
    values (p_barbershop_id, p_professional_id, 'booking', tstzrange(p_inicio, v_fim, '[)'), v_user)
    returning id into v_occ;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = '23P01';
  end;

  insert into public.bookings (barbershop_id, professional_id, customer_id, service_id, servico_nome, preco_centavos,
    duracao_min, inicio, fim, cliente_nome, cliente_whatsapp, cliente_email, consent_lembretes, consent_marketing, idempotency_key, occupancy_id)
  values (p_barbershop_id, p_professional_id, null, v_svc.id, v_svc.nome, v_svc.preco_centavos,
    v_svc.duracao_min, p_inicio, v_fim, btrim(p_nome), v_whats, v_email, coalesce(p_consent_lembretes, false),
    false, p_idempotency_key, v_occ)
  returning id into v_id;

  insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
  values (v_id, p_barbershop_id, v_user, 'created', jsonb_build_object('professional_id', p_professional_id, 'inicio', p_inicio, 'origem', 'manual'));

  return v_id;
end;
$$;

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
  with candidatos as (
    -- Revezamento entre barbearias: a 1ª da vez de cada barbearia, depois a 2ª de cada uma, e assim por diante (cada uma
    -- em ordem de proximo_envio). Uma barbearia com muitos avisos não ocupa a vez das outras.
    select e.id, e.proximo_envio, row_number() over (partition by e.barbershop_id order by e.proximo_envio, e.id) as vez
    from public.outbox_events e
    where e.status = 'pendente' and e.proximo_envio <= now() and e.canal = 'whatsapp'
      and (e.tipo = 'reserva_confirmada' or e.tipo like 'lembrete\_%' or e.tipo like 'reativacao\_%'
        or (e.tipo = 'reserva_reagendada' and e.max_tentativas = 1))
  ), alvo as (
    select o.id
    from public.outbox_events o
    join candidatos c on c.id = o.id
    where o.status = 'pendente'
    order by c.vez, c.proximo_envio
    limit p_limit
    for update of o skip locked
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
