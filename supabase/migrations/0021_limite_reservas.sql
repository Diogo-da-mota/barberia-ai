-- Barberia AI — migração 0021: limite de abuso na criação de reservas (segurança, etapa 2)
--
-- Problema: criar e cancelar reservas em ciclo, informando o WhatsApp de outra pessoa, fazia a barbearia disparar
-- "reserva criada/confirmada/cancelada" sem limite para um número de terceiro (spam e risco de bloqueio do número da barbearia).
--
-- 1) create_booking: cada conta cria no máximo 10 reservas em 24 h, somando todas as barbearias (canceladas contam).
--    Só a própria conta consome o seu limite, então ninguém bloqueia outra pessoa. A equipe da barbearia (dono, gerente,
--    barbeiro) não tem esse limite nela, para reservar por clientes de balcão. A trava passa a ser por conta, para o limite
--    valer também com pedidos simultâneos em barbearias diferentes.
-- 2) Avisos de reserva por WhatsApp: no máximo 8 por número em 24 h, em qualquer formato (+55, DDD, máscara, com ou sem o 9),
--    pela chave private.br_phone_key da 0015. Passou disso, a reserva continua valendo e o aviso fica cancelado com o motivo
--    'limite_telefone': um terceiro consegue no máximo calar avisos, nunca impedir uma reserva. O teto só vale para ações
--    do próprio cliente; avisos de ações da equipe ou do sistema sempre saem.
--
-- Reaproveita bookings, outbox_events e br_phone_key; nenhuma tabela nova. O índice novo é só sobre outbox_events (24 h).
-- Base: create_booking da 0003 e enqueue_booking_event da 0017 (igual à versão aplicada no remoto por diferenca-lembretes.sql).
-- Volta: reaplicar essas duas funções e `drop index public.idx_outbox_whatsapp_recentes`.

--------------------------------------------------------------
-- Índice para contar avisos recentes por número sem varrer a fila inteira
--------------------------------------------------------------
create index if not exists idx_outbox_whatsapp_recentes on public.outbox_events (criado_em) where canal = 'whatsapp';

--------------------------------------------------------------
-- create_booking: igual à 0003 + limite por conta (trava por conta)
--------------------------------------------------------------
create or replace function public.create_booking(
  p_barbershop_id uuid,
  p_service_id uuid,
  p_professional_id uuid,
  p_inicio timestamptz,
  p_nome text,
  p_whatsapp text,
  p_consent_lembretes boolean,
  p_consent_marketing boolean,
  p_idempotency_key text
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
  v_prof uuid;
  v_cand record;
  v_occ uuid;
  v_fim timestamptz;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if length(btrim(coalesce(p_nome, ''))) not between 1 and 120 or length(v_whats) not between 10 and 13 then
    raise exception 'invalid_contact' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.bookings where customer_id = v_user and idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  select * into v_svc from public.services where id = p_service_id and barbershop_id = p_barbershop_id and ativo;
  select fuso into v_tz from public.barbershops where id = p_barbershop_id and status = 'ativo';
  if v_svc.id is null or v_tz is null then
    raise exception 'invalid_service' using errcode = '22023';
  end if;

  -- Serializa as reservas do mesmo cliente (em todas as barbearias) para os limites valerem sob concorrência
  perform pg_advisory_xact_lock(hashtextextended('create_booking:' || v_user::text, 0));
  if (select count(*) from public.bookings
      where barbershop_id = p_barbershop_id and customer_id = v_user
        and status in ('pendente', 'confirmado') and inicio > now()) >= 3 then
    raise exception 'booking_limit' using errcode = 'P0001';
  end if;
  -- Limite por conta: 10 reservas criadas em 24 h (canceladas contam). A equipe desta barbearia não tem esse limite aqui.
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente', 'barbeiro'])
     and (select count(*) from public.bookings
          where customer_id = v_user and criado_em > now() - interval '24 hours') >= 10 then
    raise exception 'booking_rate_limited' using errcode = 'P0001';
  end if;

  v_fim := p_inicio + make_interval(mins => v_svc.duracao_min);
  for v_cand in
    select s.prof_id from private.slots(p_barbershop_id, p_service_id, p_professional_id,
      (p_inicio at time zone v_tz)::date, v_svc.duracao_min) s
    where s.slot_inicio = p_inicio
    order by s.prof_nome, s.prof_id
  loop
    begin
      insert into public.occupancies (barbershop_id, professional_id, kind, periodo, criado_por)
      values (p_barbershop_id, v_cand.prof_id, 'booking', tstzrange(p_inicio, v_fim, '[)'), v_user)
      returning id into v_occ;
      v_prof := v_cand.prof_id;
      exit;
    exception when exclusion_violation then
      continue;
    end;
  end loop;

  if v_prof is null then
    raise exception 'slot_taken' using errcode = '23P01';
  end if;

  insert into public.bookings (barbershop_id, professional_id, customer_id, service_id, servico_nome, preco_centavos,
    duracao_min, inicio, fim, cliente_nome, cliente_whatsapp, consent_lembretes, consent_marketing, idempotency_key, occupancy_id)
  values (p_barbershop_id, v_prof, v_user, v_svc.id, v_svc.nome, v_svc.preco_centavos,
    v_svc.duracao_min, p_inicio, v_fim, btrim(p_nome), v_whats, coalesce(p_consent_lembretes, false),
    coalesce(p_consent_marketing, false), p_idempotency_key, v_occ)
  returning id into v_id;

  insert into public.memberships (barbershop_id, profile_id, papel)
  values (p_barbershop_id, v_user, 'cliente')
  on conflict (barbershop_id, profile_id) do nothing;

  insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
  values (v_id, p_barbershop_id, v_user, 'created', jsonb_build_object('professional_id', v_prof, 'inicio', p_inicio));

  return v_id;
end;
$$;

--------------------------------------------------------------
-- enqueue_booking_event: igual à 0017 + teto de avisos de reserva por número (qualquer formato)
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
      case when v_limite then 'cancelado' when v_consent then 'pendente' else 'cancelado' end,
      case when v_limite then 'limite_telefone' when v_consent then null else 'sem_consentimento' end
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
