-- Aplica as migrations 0002 e 0003 em uma única transação (tudo ou nada).
begin;
-- Barberia AI — migração 0002: catálogo e equipe (F03-01, F03-02)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende da 0001. Testada localmente em supabase/tests/catalogo.test.ts.
--
-- Valores em centavos inteiros. As chaves estrangeiras compostas impedem ligar um profissional
-- a um serviço de outra barbearia, mesmo que a aplicação tente.

create table public.services (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  descricao text check (descricao is null or length(descricao) <= 300),
  preco_centavos integer not null check (preco_centavos between 0 and 10000000),
  duracao_min integer not null check (duracao_min between 5 and 480),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (id, barbershop_id),
  unique (barbershop_id, nome)
);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (id, barbershop_id),
  unique (barbershop_id, nome)
);

create table public.professional_services (
  barbershop_id uuid not null,
  professional_id uuid not null,
  service_id uuid not null,
  primary key (professional_id, service_id),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete cascade,
  foreign key (service_id, barbershop_id) references public.services (id, barbershop_id) on delete cascade
);

create index idx_services_barbershop on public.services (barbershop_id);
create index idx_professionals_barbershop on public.professionals (barbershop_id);
create index idx_professional_services_service on public.professional_services (service_id);

--------------------------------------------------------------
-- Privilégios
--------------------------------------------------------------
revoke all on table public.services, public.professionals, public.professional_services
  from public, anon, authenticated;

grant select on public.services, public.professionals, public.professional_services to authenticated;

-- barbershop_id só é definido na criação; depois não muda
grant insert (barbershop_id, nome, descricao, preco_centavos, duracao_min, ativo) on public.services to authenticated;
grant update (nome, descricao, preco_centavos, duracao_min, ativo) on public.services to authenticated;
grant delete on public.services to authenticated;

-- Profissionais são criados e alterados por save_professional, que mantém os serviços em uma transação
grant delete on public.professionals to authenticated;

--------------------------------------------------------------
-- Row Level Security: membros leem; proprietário e gerente escrevem
--------------------------------------------------------------
alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_services enable row level security;

create policy services_select on public.services
  for select to authenticated using (private.is_member(barbershop_id));
create policy services_insert on public.services
  for insert to authenticated with check (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy services_update on public.services
  for update to authenticated
  using (private.has_role(barbershop_id, array['proprietario', 'gerente']))
  with check (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy services_delete on public.services
  for delete to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

create policy professionals_select on public.professionals
  for select to authenticated using (private.is_member(barbershop_id));
create policy professionals_delete on public.professionals
  for delete to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

create policy professional_services_select on public.professional_services
  for select to authenticated using (private.is_member(barbershop_id));

--------------------------------------------------------------
-- Operação de servidor: criar ou atualizar um profissional com seus serviços
--------------------------------------------------------------
create function public.save_professional(
  p_barbershop_id uuid,
  p_id uuid,
  p_nome text,
  p_ativo boolean,
  p_service_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := p_id;
  v_ids uuid[] := coalesce(array(select distinct unnest(p_service_ids)), '{}');
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if (select count(*) from public.services where barbershop_id = p_barbershop_id and id = any (v_ids))
     <> coalesce(cardinality(v_ids), 0) then
    raise exception 'invalid_service' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.professionals (barbershop_id, nome, ativo)
    values (p_barbershop_id, btrim(p_nome), coalesce(p_ativo, true))
    returning id into v_id;
  else
    update public.professionals
    set nome = btrim(p_nome), ativo = coalesce(p_ativo, true)
    where id = v_id and barbershop_id = p_barbershop_id;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.professional_services
  where professional_id = v_id and not (service_id = any (v_ids));

  insert into public.professional_services (barbershop_id, professional_id, service_id)
  select p_barbershop_id, v_id, unnest(v_ids)
  on conflict do nothing;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (p_barbershop_id, v_user, 'professional.saved', jsonb_build_object('professional_id', v_id));

  return v_id;
end;
$$;

revoke all on function public.save_professional(uuid, uuid, text, boolean, uuid[]) from public, anon;
grant execute on function public.save_professional(uuid, uuid, text, boolean, uuid[]) to authenticated;

-- Barberia AI — migração 0003: agenda, disponibilidade e reservas (F03-03, F04, F05, F06)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende da 0001 e da 0002. Testada localmente em supabase/tests/agenda.test.ts.
--
-- Bloqueios e reservas ocupam o mesmo recurso (occupancies). A restrição de exclusão do PostgreSQL
-- impede dois intervalos sobrepostos para o mesmo profissional, mesmo com requisições simultâneas.
-- Intervalos são [início, fim): reservas contíguas são válidas.

create extension if not exists btree_gist;

alter table public.barbershops
  add column cancel_window_min integer not null default 120 check (cancel_window_min between 0 and 10080);

--------------------------------------------------------------
-- Jornada semanal (dow: 0 = domingo). Pausas são intervalos separados no mesmo dia.
--------------------------------------------------------------
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  professional_id uuid not null,
  dow smallint not null check (dow between 0 and 6),
  inicio_min smallint not null check (inicio_min between 0 and 1439),
  fim_min smallint not null check (fim_min between 1 and 1440),
  check (inicio_min < fim_min),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete cascade,
  exclude using gist (professional_id with =, dow with =, (int4range(inicio_min::int, fim_min::int)) with &&)
);

--------------------------------------------------------------
-- Ocupação única da agenda: reservas e bloqueios
--------------------------------------------------------------
create table public.occupancies (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  professional_id uuid not null,
  kind text not null check (kind in ('booking', 'block')),
  periodo tstzrange not null check (not isempty(periodo) and lower_inc(periodo) and not upper_inc(periodo)),
  motivo text check (motivo is null or length(motivo) <= 200),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete cascade,
  exclude using gist (professional_id with =, periodo with &&)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  professional_id uuid not null,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  -- Snapshot: mudar o catálogo depois não reescreve reservas antigas
  servico_nome text not null,
  preco_centavos integer not null check (preco_centavos >= 0),
  duracao_min integer not null check (duracao_min > 0),
  inicio timestamptz not null,
  fim timestamptz not null,
  status text not null default 'confirmado' check (status in ('pendente', 'confirmado', 'concluido', 'cancelado', 'nao_compareceu')),
  cliente_nome text not null,
  cliente_whatsapp text not null,
  consent_lembretes boolean not null default false,
  consent_marketing boolean not null default false,
  idempotency_key text,
  occupancy_id uuid unique references public.occupancies(id) on delete set null,
  criado_em timestamptz not null default now(),
  check (fim > inicio),
  unique (customer_id, idempotency_key),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete restrict
);

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  tipo text not null,
  detalhes jsonb,
  criado_em timestamptz not null default now()
);

create index idx_bookings_barbershop_inicio on public.bookings (barbershop_id, inicio);
create index idx_bookings_customer on public.bookings (customer_id, inicio);
create index idx_occupancies_barbershop on public.occupancies (barbershop_id);
create index idx_working_hours_professional on public.working_hours (professional_id, dow);
create index idx_booking_events_booking on public.booking_events (booking_id);

--------------------------------------------------------------
-- Privilégios e RLS: tudo é escrito por funções; o cliente só lê
--------------------------------------------------------------
revoke all on table public.working_hours, public.occupancies, public.bookings, public.booking_events
  from public, anon, authenticated;
grant select on public.working_hours, public.occupancies, public.bookings, public.booking_events to authenticated;

alter table public.working_hours enable row level security;
alter table public.occupancies enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;

create policy working_hours_select on public.working_hours
  for select to authenticated using (private.is_member(barbershop_id));
create policy occupancies_select on public.occupancies
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy bookings_select on public.bookings
  for select to authenticated
  using (customer_id = auth.uid() or private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy booking_events_select on public.booking_events
  for select to authenticated
  using (
    private.has_role(barbershop_id, array['proprietario', 'gerente'])
    or exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid())
  );

--------------------------------------------------------------
-- Disponibilidade
--------------------------------------------------------------
create function private.slots(p_barbershop_id uuid, p_service_id uuid, p_professional_id uuid, p_data date, p_dur integer)
returns table (prof_id uuid, prof_nome text, slot_inicio timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  select b.fuso into v_tz from public.barbershops b where b.id = p_barbershop_id and b.status = 'ativo';
  if v_tz is null or p_dur is null then
    return;
  end if;
  if p_data < (now() at time zone v_tz)::date or p_data > (now() at time zone v_tz)::date + 60 then
    return;
  end if;

  return query
  select pr.id, pr.nome, gs
  from public.professionals pr
  join public.professional_services ps on ps.professional_id = pr.id and ps.service_id = p_service_id
  join public.working_hours wh on wh.professional_id = pr.id and wh.dow = extract(dow from p_data)::int
  cross join lateral generate_series(
    (p_data::timestamp + make_interval(mins => wh.inicio_min)) at time zone v_tz,
    (p_data::timestamp + make_interval(mins => wh.fim_min - p_dur)) at time zone v_tz,
    interval '15 minutes'
  ) gs
  where pr.barbershop_id = p_barbershop_id
    and pr.ativo
    and (p_professional_id is null or pr.id = p_professional_id)
    and wh.fim_min - wh.inicio_min >= p_dur
    and gs >= now()
    and not exists (
      select 1 from public.occupancies o
      where o.professional_id = pr.id
        and o.periodo && tstzrange(gs, gs + make_interval(mins => p_dur), '[)')
    )
  order by gs, pr.nome;
end;
$$;

revoke all on function private.slots(uuid, uuid, uuid, date, integer) from public, anon, authenticated;

-- Horários livres de um serviço em um dia (público: a página de agendamento consulta sem login)
create function public.get_availability(p_barbershop_id uuid, p_service_id uuid, p_professional_id uuid, p_data date)
returns table (prof_id uuid, prof_nome text, slot_inicio timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.prof_id, s.prof_nome, s.slot_inicio
  from private.slots(
    p_barbershop_id, p_service_id, p_professional_id, p_data,
    (select sv.duracao_min from public.services sv where sv.id = p_service_id and sv.barbershop_id = p_barbershop_id and sv.ativo)
  ) s
$$;

-- Dados publicáveis da barbearia para a página pública (sem tabelas expostas ao visitante)
create function public.get_public_shop(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'nome', b.nome, 'slug', b.slug, 'endereco', b.endereco, 'telefone', b.telefone, 'fuso', b.fuso,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'descricao', s.descricao,
        'preco_centavos', s.preco_centavos, 'duracao_min', s.duracao_min) order by s.nome)
      from public.services s where s.barbershop_id = b.id and s.ativo), '[]'::jsonb),
    'professionals', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'service_ids', coalesce((
        select jsonb_agg(ps.service_id) from public.professional_services ps where ps.professional_id = p.id), '[]'::jsonb)
      ) order by p.nome)
      from public.professionals p where p.barbershop_id = b.id and p.ativo), '[]'::jsonb)
  )
  from public.barbershops b
  where b.slug = lower(btrim(p_slug)) and b.status = 'ativo'
$$;

--------------------------------------------------------------
-- Jornada, bloqueios e reservas (todas as escritas passam por aqui)
--------------------------------------------------------------
create function public.save_working_hours(p_professional_id uuid, p_intervals jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  select barbershop_id into v_shop from public.professionals where id = p_professional_id;
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_shop is null or not private.has_role(v_shop, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.working_hours where professional_id = p_professional_id;
  begin
    insert into public.working_hours (barbershop_id, professional_id, dow, inicio_min, fim_min)
    select v_shop, p_professional_id, (i ->> 'dow')::smallint, (i ->> 'inicio_min')::smallint, (i ->> 'fim_min')::smallint
    from jsonb_array_elements(coalesce(p_intervals, '[]'::jsonb)) i;
  exception
    when exclusion_violation then raise exception 'overlap' using errcode = '23P01';
    when check_violation then raise exception 'invalid_interval' using errcode = '22023';
  end;
end;
$$;

create function public.create_block(p_barbershop_id uuid, p_professional_id uuid, p_inicio timestamptz, p_fim timestamptz, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_fim <= p_inicio or p_fim - p_inicio > interval '31 days' then
    raise exception 'invalid_interval' using errcode = '22023';
  end if;
  begin
    insert into public.occupancies (barbershop_id, professional_id, kind, periodo, motivo, criado_por)
    values (p_barbershop_id, p_professional_id, 'block', tstzrange(p_inicio, p_fim, '[)'), nullif(btrim(p_motivo), ''), auth.uid())
    returning id into v_id;
  exception
    when exclusion_violation then raise exception 'slot_taken' using errcode = '23P01';
    when foreign_key_violation then raise exception 'forbidden' using errcode = '42501';
  end;
  return v_id;
end;
$$;

create function public.delete_block(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  select barbershop_id into v_shop from public.occupancies where id = p_id and kind = 'block';
  if v_shop is null or not private.has_role(v_shop, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.occupancies where id = p_id;
end;
$$;

create function public.create_booking(
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

  -- Serializa as reservas do mesmo cliente nesta barbearia para o limite valer sob concorrência
  perform pg_advisory_xact_lock(hashtextextended(p_barbershop_id::text || v_user::text, 0));
  if (select count(*) from public.bookings
      where barbershop_id = p_barbershop_id and customer_id = v_user
        and status in ('pendente', 'confirmado') and inicio > now()) >= 3 then
    raise exception 'booking_limit' using errcode = 'P0001';
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

create function public.cancel_booking(p_booking_id uuid)
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

-- Troca o horário em uma única transação: se o novo horário estiver ocupado, a reserva antiga permanece
create function public.reschedule_booking(p_booking_id uuid, p_novo_inicio timestamptz, p_professional_id uuid)
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
  if v_user is null or not (v_manager or b.customer_id = v_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if b.status not in ('pendente', 'confirmado') or b.service_id is null then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  select cancel_window_min, fuso into v_window, v_tz from public.barbershops where id = b.barbershop_id;
  if not v_manager and b.inicio - now() < make_interval(mins => v_window) then
    raise exception 'cancel_window' using errcode = 'P0001';
  end if;

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

  if v_prof is null then
    raise exception 'slot_taken' using errcode = '23P01';
  end if;

  update public.bookings set professional_id = v_prof, inicio = p_novo_inicio, fim = v_fim, occupancy_id = v_occ where id = b.id;
  insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
  values (b.id, b.barbershop_id, v_user, 'rescheduled', jsonb_build_object('de', b.inicio, 'para', p_novo_inicio));
end;
$$;

-- Confirmar, concluir ou marcar falta (somente gestão). Cancelar usa cancel_booking.
create function public.set_booking_status(p_booking_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or not private.has_role(b.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (
    (b.status = 'pendente' and p_status = 'confirmado')
    or (b.status = 'confirmado' and p_status in ('concluido', 'nao_compareceu') and b.inicio <= now())
  ) then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  update public.bookings set status = p_status where id = b.id;
  insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
  values (b.id, b.barbershop_id, auth.uid(), 'status', jsonb_build_object('de', b.status, 'para', p_status));
end;
$$;

--------------------------------------------------------------
-- Permissões das funções
--------------------------------------------------------------
revoke all on function
  public.get_availability(uuid, uuid, uuid, date),
  public.get_public_shop(text),
  public.save_working_hours(uuid, jsonb),
  public.create_block(uuid, uuid, timestamptz, timestamptz, text),
  public.delete_block(uuid),
  public.create_booking(uuid, uuid, uuid, timestamptz, text, text, boolean, boolean, text),
  public.cancel_booking(uuid),
  public.reschedule_booking(uuid, timestamptz, uuid),
  public.set_booking_status(uuid, text)
from public, anon;

grant execute on function public.get_availability(uuid, uuid, uuid, date) to anon, authenticated;
grant execute on function public.get_public_shop(text) to anon, authenticated;
grant execute on function
  public.save_working_hours(uuid, jsonb),
  public.create_block(uuid, uuid, timestamptz, timestamptz, text),
  public.delete_block(uuid),
  public.create_booking(uuid, uuid, uuid, timestamptz, text, text, boolean, boolean, text),
  public.cancel_booking(uuid),
  public.reschedule_booking(uuid, timestamptz, uuid),
  public.set_booking_status(uuid, text)
to authenticated;

commit;
