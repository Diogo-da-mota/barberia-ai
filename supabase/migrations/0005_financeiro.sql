-- Barberia AI — migração 0005: financeiro e comissões (F07-01 a F07-06)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0004. Testada localmente em supabase/tests/financeiro.test.ts.
--
-- Regras:
--  * Dinheiro em centavos inteiros. Percentual de comissão em pontos-base (4000 = 40%).
--  * Pagamento é FORMA DECLARADA pela gestão (pix, dinheiro, débito, crédito). Nada aqui confirma gateway.
--  * Toda escrita passa por função security definer com chave de idempotência; as tabelas só têm SELECT.
--  * O razão (financial_ledger) é somente de inserção: update e delete são bloqueados por gatilho.
--  * A regra de comissão é congelada na conclusão do atendimento (commissions.regra_*).
--  * Barbearia com histórico financeiro não pode ser apagada (on delete restrict).

--------------------------------------------------------------
-- Tabelas
--------------------------------------------------------------
create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  professional_id uuid,
  service_id uuid,
  tipo text not null check (tipo in ('percentual', 'fixo')),
  valor integer not null check (valor >= 0),
  criado_em timestamptz not null default now(),
  check (tipo <> 'percentual' or valor <= 10000),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete cascade,
  foreign key (service_id, barbershop_id) references public.services (id, barbershop_id) on delete cascade
);
create unique index uq_commission_rules_escopo on public.commission_rules (
  barbershop_id,
  coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  valor_centavos integer not null check (valor_centavos > 0),
  forma text not null check (forma in ('pix', 'dinheiro', 'debito', 'credito')),
  parcelas integer not null default 1 check (parcelas between 1 and 12),
  idempotency_key text not null check (length(idempotency_key) between 1 and 120),
  registrado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  -- declarado = "a confirmar": só entra no caixa (financial_ledger, relatório) quando a gestão confirma
  confirmado_em timestamptz,
  confirmado_por uuid references public.profiles(id) on delete set null,
  check (parcelas = 1 or forma = 'credito'),
  unique (barbershop_id, idempotency_key)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  valor_centavos integer not null check (valor_centavos > 0),
  motivo text check (motivo is null or length(motivo) <= 300),
  idempotency_key text not null check (length(idempotency_key) between 1 and 120),
  registrado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (barbershop_id, idempotency_key)
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete restrict,
  professional_id uuid not null,
  valor_centavos integer not null check (valor_centavos > 0),
  idempotency_key text not null check (length(idempotency_key) between 1 and 120),
  registrado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (barbershop_id, idempotency_key),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete restrict
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete restrict,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  professional_id uuid not null,
  base_centavos integer not null check (base_centavos >= 0),
  regra_tipo text not null check (regra_tipo in ('percentual', 'fixo')),
  regra_valor integer not null check (regra_valor >= 0),
  valor_centavos integer not null check (valor_centavos >= 0),
  status text not null default 'provisionada' check (status in ('provisionada', 'liquidada', 'cancelada')),
  payout_id uuid references public.payouts(id) on delete restrict,
  criado_em timestamptz not null default now(),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete restrict
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete restrict,
  descricao text not null check (length(btrim(descricao)) between 1 and 120),
  categoria text not null check (length(btrim(categoria)) between 1 and 40),
  valor_centavos integer not null check (valor_centavos > 0),
  data date not null,
  registrado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);

create table public.financial_ledger (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete restrict,
  tipo text not null check (tipo in ('pagamento', 'estorno', 'custo', 'comissao_provisionada', 'comissao_cancelada', 'repasse')),
  valor_centavos bigint not null,
  professional_id uuid,
  booking_id uuid,
  ref_id uuid,
  criado_em timestamptz not null default now()
);

create index idx_payments_booking on public.payments (booking_id);
create index idx_refunds_payment on public.refunds (payment_id);
create index idx_commissions_professional on public.commissions (professional_id, status);
create index idx_payouts_professional on public.payouts (professional_id);
create index idx_expenses_shop_data on public.expenses (barbershop_id, data);
create index idx_ledger_shop_tempo on public.financial_ledger (barbershop_id, criado_em);

create function private.ledger_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable' using errcode = 'P0001';
end;
$$;
create trigger financial_ledger_immutable
  before update or delete on public.financial_ledger
  for each row execute function private.ledger_immutable();

--------------------------------------------------------------
-- Privilégios e RLS: somente leitura para o cliente da API
--------------------------------------------------------------
revoke all on table public.commission_rules, public.payments, public.refunds, public.payouts,
  public.commissions, public.expenses, public.financial_ledger from public, anon, authenticated;
grant select on public.commission_rules, public.payments, public.refunds, public.payouts,
  public.commissions, public.expenses, public.financial_ledger to authenticated;

alter table public.commission_rules enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.payouts enable row level security;
alter table public.commissions enable row level security;
alter table public.expenses enable row level security;
alter table public.financial_ledger enable row level security;

create policy commission_rules_select on public.commission_rules
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy payments_select on public.payments
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy refunds_select on public.refunds
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy expenses_select on public.expenses
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy financial_ledger_select on public.financial_ledger
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
-- o barbeiro vê só os próprios ganhos e repasses
create policy commissions_select on public.commissions
  for select to authenticated
  using (private.has_role(barbershop_id, array['proprietario', 'gerente']) or private.is_my_professional(professional_id));
create policy payouts_select on public.payouts
  for select to authenticated
  using (private.has_role(barbershop_id, array['proprietario', 'gerente']) or private.is_my_professional(professional_id));

--------------------------------------------------------------
-- Comissão: regra mais específica vence (profissional+serviço > profissional > serviço > padrão)
--------------------------------------------------------------
create function public.save_commission_rule(
  p_barbershop_id uuid, p_professional_id uuid, p_service_id uuid, p_tipo text, p_valor integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('percentual', 'fixo') or p_valor is null or p_valor < 0
     or (p_tipo = 'percentual' and p_valor > 10000) then
    raise exception 'invalid_rule' using errcode = 'P0001';
  end if;
  if p_professional_id is not null and not exists (
    select 1 from public.professionals where id = p_professional_id and barbershop_id = p_barbershop_id
  ) then
    raise exception 'invalid_rule' using errcode = 'P0001';
  end if;
  if p_service_id is not null and not exists (
    select 1 from public.services where id = p_service_id and barbershop_id = p_barbershop_id
  ) then
    raise exception 'invalid_rule' using errcode = 'P0001';
  end if;

  update public.commission_rules set tipo = p_tipo, valor = p_valor
  where barbershop_id = p_barbershop_id
    and coalesce(professional_id, v_zero) = coalesce(p_professional_id, v_zero)
    and coalesce(service_id, v_zero) = coalesce(p_service_id, v_zero)
  returning id into v_id;
  if v_id is null then
    insert into public.commission_rules (barbershop_id, professional_id, service_id, tipo, valor)
    values (p_barbershop_id, p_professional_id, p_service_id, p_tipo, p_valor)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create function public.delete_commission_rule(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  select barbershop_id into v_shop from public.commission_rules where id = p_id;
  if v_shop is null or not private.has_role(v_shop, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.commission_rules where id = p_id;
end;
$$;

-- Congela a comissão do atendimento concluído; sem regra aplicável, não há comissão
create function private.freeze_commission(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  r public.commission_rules%rowtype;
  v_valor integer;
  v_id uuid;
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into r from public.commission_rules cr
  where cr.barbershop_id = b.barbershop_id
    and (cr.professional_id is null or cr.professional_id = b.professional_id)
    and (cr.service_id is null or cr.service_id = b.service_id)
  order by (cr.professional_id is not null)::int * 2 + (cr.service_id is not null)::int desc
  limit 1;
  if r.id is null then
    return;
  end if;
  if r.tipo = 'percentual' then
    v_valor := ((b.preco_centavos::bigint * r.valor + 5000) / 10000)::integer;
  else
    v_valor := least(r.valor, b.preco_centavos);
  end if;
  insert into public.commissions (barbershop_id, booking_id, professional_id, base_centavos, regra_tipo, regra_valor, valor_centavos)
  values (b.barbershop_id, b.id, b.professional_id, b.preco_centavos, r.tipo, r.valor, v_valor)
  on conflict (booking_id) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, professional_id, booking_id, ref_id)
    values (b.barbershop_id, 'comissao_provisionada', v_valor, b.professional_id, b.id, v_id);
  end if;
end;
$$;
revoke all on function private.freeze_commission(uuid) from public, anon, authenticated;

-- set_booking_status (0004) + congelamento da comissão ao concluir
create or replace function public.set_booking_status(p_booking_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  v_manager boolean;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_manager := private.has_role(b.barbershop_id, array['proprietario', 'gerente']);
  if not (v_manager or (private.is_my_professional(b.professional_id) and p_status in ('concluido', 'nao_compareceu'))) then
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
  if p_status = 'concluido' then
    perform private.freeze_commission(b.id);
  end if;
end;
$$;

-- cancel_booking (0003) + trava: reserva com pagamento líquido > 0 não cancela sem estorno
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

--------------------------------------------------------------
-- Pagamentos declarados (idempotentes)
--------------------------------------------------------------
create function public.register_payment(
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

  -- nasce "a confirmar": NÃO entra no caixa até confirm_payment (o limite acima conta o declarado e o confirmado)
  insert into public.payments (barbershop_id, booking_id, valor_centavos, forma, parcelas, idempotency_key, registrado_por)
  values (b.barbershop_id, b.id, p_valor_centavos, p_forma, p_parcelas, p_idempotency_key, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Confirmar: só aqui o valor entra no caixa (lançamento imutável no livro financeiro). Repetir é seguro.
create function public.confirm_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  b public.bookings%rowtype;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.id is null or not private.has_role(pay.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if pay.confirmado_em is not null then
    return;
  end if;
  select * into b from public.bookings where id = pay.booking_id;
  update public.payments set confirmado_em = now(), confirmado_por = auth.uid() where id = pay.id;
  insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, professional_id, booking_id, ref_id)
  values (pay.barbershop_id, 'pagamento', pay.valor_centavos, b.professional_id, b.id, pay.id);
end;
$$;

-- Descartar um pagamento ainda NÃO confirmado (declarado por engano). Confirmado só se desfaz por estorno.
create function public.discard_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.id is null or not private.has_role(pay.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if pay.confirmado_em is not null then
    raise exception 'payment_confirmed' using errcode = 'P0001';
  end if;
  delete from public.payments where id = pay.id;
end;
$$;

create function public.refund_payment(p_payment_id uuid, p_valor_centavos integer, p_motivo text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  b public.bookings%rowtype;
  e public.refunds%rowtype;
  v_ja_estornado bigint;
  v_liquido bigint;
  v_id uuid;
  c public.commissions%rowtype;
begin
  select * into pay from public.payments where id = p_payment_id;
  if pay.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = pay.booking_id for update;
  if not private.has_role(pay.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if pay.confirmado_em is null then
    raise exception 'payment_not_confirmed' using errcode = 'P0001'; -- só se estorna o que entrou no caixa
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 120
     or (p_motivo is not null and length(p_motivo) > 300) then
    raise exception 'invalid_refund' using errcode = 'P0001';
  end if;

  select * into e from public.refunds where barbershop_id = pay.barbershop_id and idempotency_key = p_idempotency_key;
  if e.id is not null then
    if e.payment_id = pay.id and e.valor_centavos = p_valor_centavos then
      return e.id;
    end if;
    raise exception 'idempotency_conflict' using errcode = 'P0001';
  end if;

  select * into c from public.commissions where booking_id = b.id;
  if c.id is not null and c.status = 'liquidada' then
    raise exception 'commission_settled' using errcode = 'P0001';
  end if;
  select coalesce(sum(valor_centavos), 0) into v_ja_estornado from public.refunds where payment_id = pay.id;
  if v_ja_estornado + p_valor_centavos > pay.valor_centavos then
    raise exception 'over_refund' using errcode = 'P0001';
  end if;

  insert into public.refunds (barbershop_id, payment_id, valor_centavos, motivo, idempotency_key, registrado_por)
  values (pay.barbershop_id, pay.id, p_valor_centavos, p_motivo, p_idempotency_key, auth.uid())
  returning id into v_id;
  insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, professional_id, booking_id, ref_id)
  values (pay.barbershop_id, 'estorno', -p_valor_centavos, b.professional_id, b.id, v_id);

  -- estorno total do atendimento antes do repasse cancela a comissão provisionada
  select coalesce(sum(p.valor_centavos), 0)
         - coalesce((select sum(r.valor_centavos) from public.refunds r where r.payment_id in (select id from public.payments where booking_id = b.id)), 0)
  into v_liquido
  from public.payments p where p.booking_id = b.id;
  if v_liquido = 0 and c.id is not null and c.status = 'provisionada' then
    update public.commissions set status = 'cancelada' where id = c.id;
    insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, professional_id, booking_id, ref_id)
    values (c.barbershop_id, 'comissao_cancelada', -c.valor_centavos, c.professional_id, c.booking_id, c.id);
  end if;
  return v_id;
end;
$$;

--------------------------------------------------------------
-- Repasses (liquidam somente comissões provisionadas)
--------------------------------------------------------------
create function public.create_payout(p_professional_id uuid, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.professionals%rowtype;
  e public.payouts%rowtype;
  v_total bigint;
  v_id uuid;
begin
  select * into pr from public.professionals where id = p_professional_id for update;
  if pr.id is null or not private.has_role(pr.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 120 then
    raise exception 'invalid_payout' using errcode = 'P0001';
  end if;
  select * into e from public.payouts where barbershop_id = pr.barbershop_id and idempotency_key = p_idempotency_key;
  if e.id is not null then
    if e.professional_id = pr.id then
      return e.id;
    end if;
    raise exception 'idempotency_conflict' using errcode = 'P0001';
  end if;

  select coalesce(sum(valor_centavos), 0) into v_total
  from public.commissions where professional_id = pr.id and status = 'provisionada';
  if v_total <= 0 then
    raise exception 'nothing_to_pay' using errcode = 'P0001';
  end if;
  insert into public.payouts (barbershop_id, professional_id, valor_centavos, idempotency_key, registrado_por)
  values (pr.barbershop_id, pr.id, v_total, p_idempotency_key, auth.uid())
  returning id into v_id;
  update public.commissions set status = 'liquidada', payout_id = v_id
  where professional_id = pr.id and status = 'provisionada';
  insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, professional_id, ref_id)
  values (pr.barbershop_id, 'repasse', -v_total, pr.id, v_id);
  return v_id;
end;
$$;

--------------------------------------------------------------
-- Custos e relatório (previsto × recebido)
--------------------------------------------------------------
create function public.add_expense(p_barbershop_id uuid, p_descricao text, p_categoria text, p_valor_centavos integer, p_data date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_valor_centavos is null or p_valor_centavos <= 0 or p_data is null
     or p_descricao is null or length(btrim(p_descricao)) not between 1 and 120
     or p_categoria is null or length(btrim(p_categoria)) not between 1 and 40 then
    raise exception 'invalid_expense' using errcode = 'P0001';
  end if;
  insert into public.expenses (barbershop_id, descricao, categoria, valor_centavos, data, registrado_por)
  values (p_barbershop_id, btrim(p_descricao), btrim(p_categoria), p_valor_centavos, p_data, auth.uid())
  returning id into v_id;
  insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, ref_id)
  values (p_barbershop_id, 'custo', -p_valor_centavos, v_id);
  return v_id;
end;
$$;

create function public.finance_report(p_barbershop_id uuid, p_de date, p_ate date)
returns table (
  previsto_centavos bigint,
  recebido_centavos bigint,
  custos_centavos bigint,
  comissoes_provisionadas_centavos bigint,
  comissoes_liquidadas_centavos bigint,
  resultado_estimado_centavos bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_fuso text;
  v_prev bigint;
  v_rec bigint;
  v_cus bigint;
  v_prov bigint;
  v_liq bigint;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;
  select fuso into v_fuso from public.barbershops where id = p_barbershop_id;

  select coalesce(sum(preco_centavos), 0) into v_prev from public.bookings
  where barbershop_id = p_barbershop_id and status in ('pendente', 'confirmado', 'concluido')
    and (inicio at time zone v_fuso)::date between p_de and p_ate;
  select coalesce(sum(valor_centavos), 0) into v_rec from public.financial_ledger
  where barbershop_id = p_barbershop_id and tipo in ('pagamento', 'estorno')
    and (criado_em at time zone v_fuso)::date between p_de and p_ate;
  select coalesce(sum(valor_centavos), 0) into v_cus from public.expenses
  where barbershop_id = p_barbershop_id and data between p_de and p_ate;
  select coalesce(sum(valor_centavos) filter (where status = 'provisionada'), 0),
         coalesce(sum(valor_centavos) filter (where status = 'liquidada'), 0)
  into v_prov, v_liq from public.commissions
  where barbershop_id = p_barbershop_id and (criado_em at time zone v_fuso)::date between p_de and p_ate;

  return query select v_prev, v_rec, v_cus, v_prov, v_liq, v_rec - v_cus - v_prov - v_liq;
end;
$$;

--------------------------------------------------------------
-- Permissões das funções
--------------------------------------------------------------
revoke all on function
  public.save_commission_rule(uuid, uuid, uuid, text, integer),
  public.delete_commission_rule(uuid),
  public.register_payment(uuid, integer, text, integer, text),
  public.confirm_payment(uuid),
  public.discard_payment(uuid),
  public.refund_payment(uuid, integer, text, text),
  public.create_payout(uuid, text),
  public.add_expense(uuid, text, text, integer, date),
  public.finance_report(uuid, date, date),
  public.set_booking_status(uuid, text)
from public, anon;
grant execute on function
  public.save_commission_rule(uuid, uuid, uuid, text, integer),
  public.delete_commission_rule(uuid),
  public.register_payment(uuid, integer, text, integer, text),
  public.confirm_payment(uuid),
  public.discard_payment(uuid),
  public.refund_payment(uuid, integer, text, text),
  public.create_payout(uuid, text),
  public.add_expense(uuid, text, text, integer, date),
  public.finance_report(uuid, date, date),
  public.set_booking_status(uuid, text)
to authenticated;
