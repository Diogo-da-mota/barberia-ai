-- Barberia AI — migração 0008: planos e assinaturas SaaS (F11-01, F11-03 lado banco, F11-04, F11-05)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0004. Testada localmente em supabase/tests/planos.test.ts.
--
-- NÃO há cobrança real aqui. Preços ficam NULOS (decisão de negócio pendente) e nenhum plano é `comercial` até que
-- um provedor de cobrança seja aprovado (bloqueio F11-02). Os eventos de cobrança entram por apply_billing_event
-- (service_role), de forma idempotente e tolerante a ordem. Os limites são medidos por gatilhos no banco: o
-- navegador não consegue contorná-los. A assinatura de uma barbearia é separada dos pagamentos dos serviços (0005).

create table public.plans (
  id text primary key,
  nome text not null,
  preco_mensal_centavos integer check (preco_mensal_centavos is null or preco_mensal_centavos >= 0),
  max_profissionais integer check (max_profissionais is null or max_profissionais >= 1), -- null = sem limite
  trial_dias integer not null default 14 check (trial_dias between 0 and 90),
  comercial boolean not null default false,
  ordem integer not null unique
);
insert into public.plans (id, nome, max_profissionais, trial_dias, ordem) values
  ('inicial', 'Inicial', 2, 14, 1),
  ('profissional', 'Profissional', 6, 14, 2),
  ('rede', 'Rede', null, 14, 3);

create table public.subscriptions (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'trial' check (status in ('trial', 'ativa', 'inadimplente', 'suspensa', 'cancelada')),
  trial_ate timestamptz,
  periodo_fim timestamptz,
  ultimo_evento_em timestamptz,
  provider text,
  provider_ref text,
  atualizado_em timestamptz not null default now()
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null check (length(event_id) between 1 and 200),
  barbershop_id uuid references public.barbershops(id) on delete cascade,
  tipo text not null,
  status text not null check (status in ('processado', 'ignorado', 'rejeitado')),
  motivo text,
  ts_evento timestamptz,
  recebido_em timestamptz not null default now(),
  unique (provider, event_id)
);

revoke all on table public.plans, public.subscriptions, public.billing_events from public, anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.subscriptions to authenticated;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
create policy plans_select on public.plans for select to anon, authenticated using (true);
create policy subscriptions_select on public.subscriptions
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

--------------------------------------------------------------
-- Estado da assinatura
--------------------------------------------------------------
create function private.subscription_allows(p_barbershop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case s.status
      when 'trial' then s.trial_ate > now()
      when 'ativa' then true
      when 'inadimplente' then coalesce(s.periodo_fim, now()) + interval '7 days' > now()
      else false
    end
    from public.subscriptions s where s.barbershop_id = p_barbershop_id
  ), true) -- barbearia sem assinatura (legado) segue funcionando até o backfill
$$;
revoke all on function private.subscription_allows(uuid) from public, anon, authenticated;

-- toda barbearia nova começa em teste no plano inicial
create function private.start_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (barbershop_id, plan_id, status, trial_ate)
  select new.id, p.id, 'trial', now() + make_interval(days => p.trial_dias) from public.plans p where p.id = 'inicial';
  return new;
end;
$$;
create trigger barbershops_subscription after insert on public.barbershops
  for each row execute function private.start_subscription();

-- barbearias já existentes ganham o período de teste a partir da aplicação desta migration
insert into public.subscriptions (barbershop_id, plan_id, status, trial_ate)
select b.id, 'inicial', 'trial', now() + interval '14 days' from public.barbershops b
on conflict (barbershop_id) do nothing;

--------------------------------------------------------------
-- Limites no servidor
--------------------------------------------------------------
create function private.enforce_professional_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_ativos integer;
begin
  if not new.ativo or (tg_op = 'UPDATE' and old.ativo) then
    return new;
  end if;
  if not private.subscription_allows(new.barbershop_id) then
    raise exception 'subscription_inactive' using errcode = 'P0001';
  end if;
  select p.max_profissionais into v_max
  from public.subscriptions s join public.plans p on p.id = s.plan_id where s.barbershop_id = new.barbershop_id;
  if v_max is not null then
    select count(*) into v_ativos from public.professionals
    where barbershop_id = new.barbershop_id and ativo and id <> new.id;
    if v_ativos >= v_max then
      raise exception 'plan_limit' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger professionals_plan_limit before insert or update of ativo on public.professionals
  for each row execute function private.enforce_professional_limit();

create function private.enforce_booking_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.subscription_allows(new.barbershop_id) then
    raise exception 'subscription_inactive' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger bookings_subscription before insert on public.bookings
  for each row execute function private.enforce_booking_subscription();

-- no máximo 3 barbearias por proprietário
create function private.enforce_shop_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.barbershops where owner_id = new.owner_id) >= 3 then
    raise exception 'shop_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger barbershops_owner_limit before insert on public.barbershops
  for each row execute function private.enforce_shop_limit();

create function public.get_plan_usage(p_barbershop_id uuid)
returns table (
  plano text, status text, max_profissionais integer, profissionais_ativos integer,
  trial_ate timestamptz, periodo_fim timestamptz, permite_novos boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select s.plan_id, s.status, p.max_profissionais,
         (select count(*)::integer from public.professionals x where x.barbershop_id = s.barbershop_id and x.ativo),
         s.trial_ate, s.periodo_fim, private.subscription_allows(s.barbershop_id)
  from public.subscriptions s join public.plans p on p.id = s.plan_id
  where s.barbershop_id = p_barbershop_id;
end;
$$;

--------------------------------------------------------------
-- Servidor (service_role): troca de plano e eventos de cobrança
--------------------------------------------------------------
create function public.change_plan(p_barbershop_id uuid, p_plan_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_ativos integer;
begin
  select max_profissionais into v_max from public.plans where id = p_plan_id;
  if not found then
    raise exception 'invalid_plan' using errcode = 'P0001';
  end if;
  perform 1 from public.subscriptions where barbershop_id = p_barbershop_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select count(*) into v_ativos from public.professionals where barbershop_id = p_barbershop_id and ativo;
  if v_max is not null and v_ativos > v_max then
    return 'downgrade_blocked';
  end if;
  update public.subscriptions set plan_id = p_plan_id, atualizado_em = now() where barbershop_id = p_barbershop_id;
  return 'ok';
end;
$$;

create function public.apply_billing_event(
  p_provider text, p_event_id text, p_barbershop_id uuid, p_tipo text, p_plan_id text, p_periodo_fim timestamptz, p_ts timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscriptions%rowtype;
  v_log uuid;
  v_novo text;
  v_resultado text;
begin
  if p_tipo is null or p_tipo not in ('ativada', 'renovada', 'reativada', 'pagamento_falhou', 'suspensa', 'cancelada') then
    raise exception 'invalid_event' using errcode = 'P0001';
  end if;
  select * into s from public.subscriptions where barbershop_id = p_barbershop_id for update;
  if s.barbershop_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.billing_events (provider, event_id, barbershop_id, tipo, status, ts_evento)
  values (p_provider, p_event_id, p_barbershop_id, p_tipo, 'processado', p_ts)
  on conflict (provider, event_id) do nothing
  returning id into v_log;
  if v_log is null then
    return 'duplicado';
  end if;

  if p_ts is null or (s.ultimo_evento_em is not null and p_ts <= s.ultimo_evento_em) then
    update public.billing_events set status = 'ignorado', motivo = 'fora_de_ordem' where id = v_log;
    return 'ignorado';
  end if;

  v_novo := case p_tipo
    when 'ativada' then 'ativa' when 'renovada' then 'ativa' when 'reativada' then 'ativa'
    when 'pagamento_falhou' then 'inadimplente' when 'suspensa' then 'suspensa' else 'cancelada' end;

  if p_plan_id is not null and p_plan_id <> s.plan_id then
    v_resultado := public.change_plan(p_barbershop_id, p_plan_id);
    if v_resultado = 'downgrade_blocked' then
      update public.billing_events set status = 'rejeitado', motivo = 'downgrade_blocked' where id = v_log;
      return 'rejeitado';
    end if;
  end if;

  update public.subscriptions
  set status = v_novo, periodo_fim = coalesce(p_periodo_fim, periodo_fim), ultimo_evento_em = p_ts,
      provider = p_provider, atualizado_em = now()
  where barbershop_id = p_barbershop_id;
  return 'processado';
end;
$$;

revoke all on function public.change_plan(uuid, text), public.apply_billing_event(text, text, uuid, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.change_plan(uuid, text), public.apply_billing_event(text, text, uuid, text, text, timestamptz, timestamptz)
  to service_role;
revoke all on function public.get_plan_usage(uuid) from public, anon;
grant execute on function public.get_plan_usage(uuid) to authenticated;
