-- Aplica as migrations 0005 a 0009 (financeiro, eventos, site, planos, calendário) em uma única transação.
-- JÁ APLICADAS NO REMOTO. Use só em um banco novo. A ordem importa (0009 substitui funções da 0006).
begin;

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

-- Barberia AI — migração 0006: outbox/inbox de eventos, WhatsApp, lembretes e consentimentos (F08-01 a F08-07)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0005. Testada localmente em supabase/tests/eventos.test.ts.
--
-- Esta migration NÃO envia mensagens. Ela só guarda o que deve ser enviado (outbox), o que chegou (inbox) e o
-- resultado. O envio é feito pelo worker de servidor (Edge Function com service_role) e fica BLOQUEADO enquanto a
-- barbearia não tiver canal WhatsApp ativo (integration_accounts) — nunca simulamos entrega.
-- Funções do worker/webhook só executam como service_role; o cliente da API nunca as chama.

--------------------------------------------------------------
-- Consentimentos (marketing separado dos avisos da reserva) com trilha de auditoria
--------------------------------------------------------------
create table public.customer_consents (
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  marketing boolean not null default false,
  opt_out_em timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (barbershop_id, profile_id)
);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('opt_in', 'opt_out')),
  origem text not null check (origem in ('app', 'reserva', 'whatsapp')),
  criado_em timestamptz not null default now()
);
create index idx_consent_events_profile on public.consent_events (barbershop_id, profile_id, criado_em);

-- registra a mudança de marketing (somente se houve mudança)
create function private.apply_marketing_consent(p_shop uuid, p_profile uuid, p_marketing boolean, p_origem text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes boolean;
begin
  select marketing into v_antes from public.customer_consents where barbershop_id = p_shop and profile_id = p_profile;
  if v_antes is null then
    if not p_marketing then
      return;
    end if;
    insert into public.customer_consents (barbershop_id, profile_id, marketing) values (p_shop, p_profile, true);
  elsif v_antes = p_marketing then
    return;
  else
    update public.customer_consents
    set marketing = p_marketing, atualizado_em = now(), opt_out_em = case when p_marketing then null else now() end
    where barbershop_id = p_shop and profile_id = p_profile;
  end if;
  insert into public.consent_events (barbershop_id, profile_id, tipo, origem)
  values (p_shop, p_profile, case when p_marketing then 'opt_in' else 'opt_out' end, p_origem);
end;
$$;
revoke all on function private.apply_marketing_consent(uuid, uuid, boolean, text) from public, anon, authenticated;

create function private.booking_consent_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.consent_marketing then
    perform private.apply_marketing_consent(new.barbershop_id, new.customer_id, true, 'reserva');
  end if;
  return new;
end;
$$;
create trigger bookings_consent after insert on public.bookings
  for each row execute function private.booking_consent_trigger();

create function public.set_marketing_consent(p_barbershop_id uuid, p_marketing boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member(p_barbershop_id) or p_marketing is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.apply_marketing_consent(p_barbershop_id, auth.uid(), p_marketing, 'app');
end;
$$;

-- Números que pediram PARAR (qualquer aviso). O WhatsApp informado na reserva não é verificado, então o titular
-- do número precisa de um jeito de parar tudo. Sem nenhum acesso pela API: só as funções de servidor leem e gravam.
create table public.phone_blocklist (
  telefone text primary key check (telefone ~ '^[0-9]{10}$'),
  criado_em timestamptz not null default now()
);
revoke all on table public.phone_blocklist from public, anon, authenticated;
alter table public.phone_blocklist enable row level security;

--------------------------------------------------------------
-- Canais de integração (sem segredos: credenciais ficam só nos secrets do servidor)
--------------------------------------------------------------
create table public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  provider text not null check (provider in ('whatsapp')),
  status text not null default 'nao_configurado' check (status in ('nao_configurado', 'ativo', 'suspenso')),
  atualizado_em timestamptz not null default now(),
  unique (barbershop_id, provider)
);

--------------------------------------------------------------
-- Outbox (o que enviar) e logs de envio
--------------------------------------------------------------
create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  customer_id uuid references public.profiles(id) on delete set null,
  tipo text not null,
  canal text not null default 'whatsapp' check (canal in ('whatsapp')),
  destino text not null,
  payload jsonb not null default '{}',
  dedup_key text not null unique,
  status text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviado', 'falhou', 'bloqueado', 'cancelado')),
  tentativas integer not null default 0,
  max_tentativas integer not null default 5 check (max_tentativas between 1 and 10),
  proximo_envio timestamptz not null default now(),
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index idx_outbox_fila on public.outbox_events (status, proximo_envio);
create index idx_outbox_booking on public.outbox_events (booking_id);
create index idx_outbox_shop on public.outbox_events (barbershop_id, criado_em);

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.outbox_events(id) on delete cascade,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  status text not null check (status in ('enviado', 'falhou')),
  provider_message_id text,
  erro text check (erro is null or length(erro) <= 300),
  criado_em timestamptz not null default now()
);
create index idx_notification_logs_msg on public.notification_logs (provider_message_id);
create index idx_notification_logs_outbox on public.notification_logs (outbox_id);

--------------------------------------------------------------
-- Inbox (o que chegou): deduplicação por (provedor, id do evento)
--------------------------------------------------------------
create table public.inbound_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null check (length(event_id) between 1 and 200),
  barbershop_id uuid references public.barbershops(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  ts_evento timestamptz,
  status text not null default 'ignorado' check (status in ('processado', 'ignorado', 'rejeitado')),
  motivo text,
  recebido_em timestamptz not null default now(),
  unique (provider, event_id)
);
create index idx_inbound_recebido on public.inbound_webhook_events (provider, recebido_em);

--------------------------------------------------------------
-- Privilégios e RLS (leitura só pela gestão)
--------------------------------------------------------------
revoke all on table public.customer_consents, public.consent_events, public.integration_accounts,
  public.outbox_events, public.notification_logs, public.inbound_webhook_events from public, anon, authenticated;
grant select on public.customer_consents, public.consent_events, public.integration_accounts,
  public.outbox_events, public.notification_logs, public.inbound_webhook_events to authenticated;

alter table public.customer_consents enable row level security;
alter table public.consent_events enable row level security;
alter table public.integration_accounts enable row level security;
alter table public.outbox_events enable row level security;
alter table public.notification_logs enable row level security;
alter table public.inbound_webhook_events enable row level security;

create policy customer_consents_select on public.customer_consents
  for select to authenticated
  using (profile_id = auth.uid() or private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy consent_events_select on public.consent_events
  for select to authenticated
  using (profile_id = auth.uid() or private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy integration_accounts_select on public.integration_accounts
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy outbox_events_select on public.outbox_events
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy notification_logs_select on public.notification_logs
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy inbound_webhook_events_select on public.inbound_webhook_events
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

--------------------------------------------------------------
-- Eventos da reserva → outbox (na mesma transação do evento; deduplicado)
--------------------------------------------------------------
create function private.enqueue_booking_event()
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

  if v_tipo = 'reserva_cancelada' then
    update public.outbox_events
    set status = 'cancelado', ultimo_erro = 'reserva_cancelada', atualizado_em = now()
    where booking_id = b.id and status in ('pendente', 'bloqueado')
      and (tipo like 'lembrete%' or tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_reagendada'));
  end if;

  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key, status, ultimo_erro)
  values (
    b.barbershop_id, b.id, b.customer_id, v_tipo, b.cliente_whatsapp,
    jsonb_build_object(
      'booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', v_prof,
      'inicio', b.inicio, 'fim', b.fim, 'fuso', v_shop.fuso, 'barbearia', v_shop.nome, 'endereco', v_shop.endereco
    ),
    b.id || ':' || v_tipo || ':' || new.id,
    case when v_consent then 'pendente' else 'cancelado' end,
    case when v_consent then null else 'sem_consentimento' end
  )
  on conflict (dedup_key) do nothing;
  return new;
end;
$$;
create trigger booking_events_outbox after insert on public.booking_events
  for each row execute function private.enqueue_booking_event();

--------------------------------------------------------------
-- Worker (service_role): reivindicar, concluir, liberar bloqueados
--------------------------------------------------------------
create function public.claim_outbox(p_limit integer default 20)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 20;
  end if;
  -- envios que ficaram presos (worker caiu) voltam para a fila
  update public.outbox_events set status = 'pendente', atualizado_em = now()
  where status = 'enviando' and atualizado_em < now() - interval '10 minutes';

  -- recuperação de clientes: opt-out vale até o último instante
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'opt_out', atualizado_em = now()
  where e.status in ('pendente', 'bloqueado') and e.tipo like 'reativacao%'
    and not exists (
      select 1 from public.customer_consents c
      where c.barbershop_id = e.barbershop_id and c.profile_id = e.customer_id and c.marketing
    );

  -- número que pediu PARAR não recebe nada (nem avisos da reserva): o titular do número pode não ser quem reservou
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'numero_bloqueado', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status in ('pendente', 'bloqueado')
    and exists (select 1 from public.phone_blocklist b where b.telefone = right(regexp_replace(e.destino, '\D', '', 'g'), 10));

  -- no máximo 12 mensagens por número em 24h (3 reservas × 3 avisos): a barbearia não pode virar canal de spam para terceiros
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'limite_destino', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status = 'pendente'
    and (
      select count(*) from public.outbox_events x
      where x.canal = 'whatsapp' and x.status in ('enviado', 'enviando') and x.atualizado_em > now() - interval '24 hours'
        and right(regexp_replace(x.destino, '\D', '', 'g'), 10) = right(regexp_replace(e.destino, '\D', '', 'g'), 10)
    ) >= 12;

  -- sem canal ativo: nada é enviado nem simulado
  update public.outbox_events e
  set status = 'bloqueado', ultimo_erro = 'canal_nao_configurado', atualizado_em = now()
  where e.status = 'pendente' and e.proximo_envio <= now()
    and not exists (
      select 1 from public.integration_accounts i
      where i.barbershop_id = e.barbershop_id and i.provider = 'whatsapp' and i.status = 'ativo'
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

create function public.complete_outbox(p_id uuid, p_ok boolean, p_provider_message_id text, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.outbox_events%rowtype;
  v_erro text := left(p_erro, 300);
begin
  select * into e from public.outbox_events where id = p_id for update;
  if e.id is null or e.status <> 'enviando' then
    return; -- evento inexistente ou já finalizado: nunca regride
  end if;
  if p_ok then
    update public.outbox_events set status = 'enviado', ultimo_erro = null, atualizado_em = now() where id = e.id;
    insert into public.notification_logs (outbox_id, barbershop_id, status, provider_message_id)
    values (e.id, e.barbershop_id, 'enviado', left(p_provider_message_id, 200));
  else
    update public.outbox_events
    set status = case when e.tentativas >= e.max_tentativas then 'falhou' else 'pendente' end,
        ultimo_erro = v_erro,
        proximo_envio = now() + make_interval(mins => least(power(2, e.tentativas)::integer, 120)),
        atualizado_em = now()
    where id = e.id;
    insert into public.notification_logs (outbox_id, barbershop_id, status, erro)
    values (e.id, e.barbershop_id, 'falhou', v_erro);
  end if;
end;
$$;

create function public.set_integration_status(p_barbershop_id uuid, p_provider text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('nao_configurado', 'ativo', 'suspenso') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  insert into public.integration_accounts (barbershop_id, provider, status)
  values (p_barbershop_id, p_provider, p_status)
  on conflict (barbershop_id, provider) do update set status = excluded.status, atualizado_em = now();
end;
$$;

create function public.release_blocked_outbox(p_barbershop_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.outbox_events
  set status = 'pendente', ultimo_erro = null, proximo_envio = now(), atualizado_em = now()
  where barbershop_id = p_barbershop_id and status = 'bloqueado';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

--------------------------------------------------------------
-- Lembretes (24h e 2h) e recuperação (30/45/60 dias)
--------------------------------------------------------------
create function public.schedule_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_i integer;
begin
  -- 24h: só quando a reserva foi feita com mais de 24h de antecedência e ainda faltam mais de 2h
  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
  select b.barbershop_id, b.id, b.customer_id, 'lembrete_24h', b.cliente_whatsapp,
         jsonb_build_object('booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', p.nome,
           'inicio', b.inicio, 'fim', b.fim, 'fuso', s.fuso, 'barbearia', s.nome, 'endereco', s.endereco),
         b.id || ':lembrete_24h:' || extract(epoch from b.inicio)::bigint
  from public.bookings b
  join public.professionals p on p.id = b.professional_id
  join public.barbershops s on s.id = b.barbershop_id
  where b.status = 'confirmado' and b.consent_lembretes
    and b.inicio > now() + interval '2 hours'
    and b.inicio - interval '24 hours' <= now()
    and b.criado_em <= b.inicio - interval '24 hours'
  on conflict (dedup_key) do nothing;
  get diagnostics v_i = row_count;
  v_n := v_n + v_i;

  -- 2h: quando faltam entre 15 minutos e 2 horas
  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
  select b.barbershop_id, b.id, b.customer_id, 'lembrete_2h', b.cliente_whatsapp,
         jsonb_build_object('booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', p.nome,
           'inicio', b.inicio, 'fim', b.fim, 'fuso', s.fuso, 'barbearia', s.nome, 'endereco', s.endereco),
         b.id || ':lembrete_2h:' || extract(epoch from b.inicio)::bigint
  from public.bookings b
  join public.professionals p on p.id = b.professional_id
  join public.barbershops s on s.id = b.barbershop_id
  where b.status = 'confirmado' and b.consent_lembretes
    and b.inicio > now() + interval '15 minutes'
    and b.inicio - interval '2 hours' <= now()
  on conflict (dedup_key) do nothing;
  get diagnostics v_i = row_count;
  v_n := v_n + v_i;
  return v_n;
end;
$$;

create function public.schedule_reactivation()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with ultimo as (
    select distinct on (b.barbershop_id, b.customer_id)
      b.barbershop_id, b.customer_id, b.id as booking_id, b.cliente_whatsapp, b.cliente_nome, b.inicio,
      floor(extract(epoch from now() - b.inicio) / 86400)::integer as dias
    from public.bookings b
    where b.status = 'concluido'
    order by b.barbershop_id, b.customer_id, b.inicio desc
  ),
  etapa as (
    select u.*, (
      select max(n) from unnest(array[30, 45, 60]) n where u.dias >= n and u.dias < n + 7
    ) as n
    from ultimo u
  )
  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
  select e.barbershop_id, e.booking_id, e.customer_id, 'reativacao_' || e.n, e.cliente_whatsapp,
         jsonb_build_object('cliente', e.cliente_nome, 'dias', e.dias, 'barbearia', s.nome, 'fuso', s.fuso),
         'reativacao_' || e.n || ':' || e.barbershop_id || ':' || e.customer_id || ':' || e.booking_id
  from etapa e
  join public.barbershops s on s.id = e.barbershop_id
  join public.customer_consents c on c.barbershop_id = e.barbershop_id and c.profile_id = e.customer_id and c.marketing
  where e.n is not null
    and not exists (
      select 1 from public.bookings f
      where f.barbershop_id = e.barbershop_id and f.customer_id = e.customer_id
        and f.status in ('pendente', 'confirmado') and f.inicio > now()
    )
  on conflict (dedup_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

--------------------------------------------------------------
-- Webhook de entrada (service_role): replay, duplicidade, limite e correlação segura
--------------------------------------------------------------
create function public.process_whatsapp_reply(
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

--------------------------------------------------------------
-- Painel: apagar uma mensagem (gestão). Remove o evento e seus registros de envio; NÃO mexe na reserva nem no financeiro.
--------------------------------------------------------------
create function public.delete_outbox_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.outbox_events%rowtype;
begin
  select * into e from public.outbox_events where id = p_id for update;
  if e.id is null or not private.has_role(e.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if e.status = 'enviando' then
    raise exception 'in_flight' using errcode = 'P0001'; -- o worker está enviando agora
  end if;
  delete from public.outbox_events where id = e.id; -- notification_logs sai junto (on delete cascade)
  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (e.barbershop_id, auth.uid(), 'outbox.deleted', jsonb_build_object('tipo', e.tipo, 'booking_id', e.booking_id));
end;
$$;

--------------------------------------------------------------
-- Painel: resumo de envios (gestão)
--------------------------------------------------------------
create function public.outbox_summary(p_barbershop_id uuid)
returns table (status text, total bigint)
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
  select e.status, count(*) from public.outbox_events e where e.barbershop_id = p_barbershop_id group by e.status order by e.status;
end;
$$;

--------------------------------------------------------------
-- Permissões das funções
--------------------------------------------------------------
revoke all on function
  public.claim_outbox(integer),
  public.complete_outbox(uuid, boolean, text, text),
  public.set_integration_status(uuid, text, text),
  public.release_blocked_outbox(uuid),
  public.schedule_reminders(),
  public.schedule_reactivation(),
  public.process_whatsapp_reply(text, timestamptz, text, text, text)
from public, anon, authenticated;
grant execute on function
  public.claim_outbox(integer),
  public.complete_outbox(uuid, boolean, text, text),
  public.set_integration_status(uuid, text, text),
  public.release_blocked_outbox(uuid),
  public.schedule_reminders(),
  public.schedule_reactivation(),
  public.process_whatsapp_reply(text, timestamptz, text, text, text)
to service_role;

revoke all on function public.set_marketing_consent(uuid, boolean), public.outbox_summary(uuid), public.delete_outbox_event(uuid) from public, anon;
grant execute on function public.set_marketing_consent(uuid, boolean), public.outbox_summary(uuid), public.delete_outbox_event(uuid) to authenticated;

-- Barberia AI — migração 0007: site personalizável e mídia (F09-01 a F09-04)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0004 (independe de 0005/0006). Testada localmente em supabase/tests/site.test.ts.
--
-- Personalização limitada: cor de destaque só da paleta do Design System (contraste garantido), textos curtos.
-- Mídia: bucket `site-media` (leitura pública, só imagens jpeg/png/webp até 2 MB). Escrita no storage só pela gestão
-- da própria empresa (prefixo <barbershop_id>/). register_media confere o objeto REAL no storage antes de publicar.

alter table public.barbershops
  add column descricao text check (descricao is null or length(descricao) <= 500),
  add column cor_destaque text check (cor_destaque is null or cor_destaque in ('ambar', 'azul', 'verde', 'vermelho', 'violeta'));

create table public.media_objects (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  kind text not null check (kind in ('logo', 'capa', 'galeria')),
  storage_path text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  tamanho_bytes integer not null check (tamanho_bytes between 1 and 2097152),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index uq_media_logo_capa on public.media_objects (barbershop_id, kind) where kind in ('logo', 'capa');
create index idx_media_shop on public.media_objects (barbershop_id, kind);

revoke all on table public.media_objects from public, anon, authenticated;
grant select on public.media_objects to authenticated;
alter table public.media_objects enable row level security;
create policy media_objects_select on public.media_objects
  for select to authenticated using (private.is_member(barbershop_id) and not private.has_role(barbershop_id, array['cliente']));

--------------------------------------------------------------
-- Storage: bucket e políticas
--------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- o primeiro segmento do caminho precisa ser o id de uma barbearia em que o usuário é proprietário ou gerente
create function private.can_write_site_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.has_role(((storage.foldername(p_name))[1])::uuid, array['proprietario', 'gerente'])
    else false
  end
$$;
revoke all on function private.can_write_site_media(text) from public, anon;
grant execute on function private.can_write_site_media(text) to authenticated;

create policy site_media_select on storage.objects
  for select using (bucket_id = 'site-media');
create policy site_media_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'site-media' and private.can_write_site_media(name));
create policy site_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'site-media' and private.can_write_site_media(name))
  with check (bucket_id = 'site-media' and private.can_write_site_media(name));
create policy site_media_delete on storage.objects
  for delete to authenticated using (bucket_id = 'site-media' and private.can_write_site_media(name));

--------------------------------------------------------------
-- Perfil do site e link público
--------------------------------------------------------------
create function public.save_site_profile(
  p_barbershop_id uuid, p_descricao text, p_cor text, p_endereco text, p_telefone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_end text := nullif(btrim(coalesce(p_endereco, '')), '');
  v_tel text := nullif(btrim(coalesce(p_telefone, '')), '');
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (v_desc is not null and length(v_desc) > 500)
     or (v_end is not null and length(v_end) > 200)
     or (v_tel is not null and (length(v_tel) > 20 or v_tel !~ '^[0-9()+ -]+$'))
     or (p_cor is not null and p_cor not in ('ambar', 'azul', 'verde', 'vermelho', 'violeta')) then
    raise exception 'invalid_site' using errcode = 'P0001';
  end if;
  update public.barbershops
  set descricao = v_desc, cor_destaque = p_cor, endereco = v_end, telefone = v_tel
  where id = p_barbershop_id;
end;
$$;

create function public.set_shop_slug(p_barbershop_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_barbershop_id, array['proprietario']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) not between 3 and 60 then
    raise exception 'invalid_slug' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.barbershops where slug = p_slug and id <> p_barbershop_id) then
    raise exception 'slug_taken' using errcode = '23505';
  end if;
  update public.barbershops set slug = p_slug where id = p_barbershop_id;
end;
$$;

--------------------------------------------------------------
-- Mídia: o servidor confere o objeto real, o prefixo e os limites
--------------------------------------------------------------
create function public.register_media(p_barbershop_id uuid, p_kind text, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_mime text;
  v_size bigint;
  v_id uuid;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('logo', 'capa', 'galeria')
     or p_path is null or p_path !~ ('^' || p_barbershop_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$') then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  select * into o from storage.objects where bucket_id = 'site-media' and name = p_path;
  if o.name is null then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  v_mime := o.metadata ->> 'mimetype';
  v_size := (o.metadata ->> 'size')::bigint;
  if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp') or v_size is null or v_size < 1 or v_size > 2097152 then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;

  if p_kind = 'galeria' then
    if (select count(*) from public.media_objects where barbershop_id = p_barbershop_id and kind = 'galeria') >= 8 then
      raise exception 'media_limit' using errcode = 'P0001';
    end if;
  else
    delete from public.media_objects where barbershop_id = p_barbershop_id and kind = p_kind;
  end if;
  insert into public.media_objects (barbershop_id, kind, storage_path, mime, tamanho_bytes, criado_por)
  values (p_barbershop_id, p_kind, p_path, v_mime, v_size::integer, auth.uid())
  on conflict (storage_path) do update set kind = excluded.kind
  returning id into v_id;
  return v_id;
end;
$$;

-- remove o registro e devolve o caminho; o cliente apaga o arquivo pela API de storage (política de delete acima)
create function public.delete_media(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.media_objects%rowtype;
begin
  select * into m from public.media_objects where id = p_id;
  if m.id is null or not private.has_role(m.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.media_objects where id = m.id;
  return m.storage_path;
end;
$$;

--------------------------------------------------------------
-- Foto de perfil do profissional (coluna professionals.avatar_path, criada na 0002 e liberada para leitura na 0004)
--------------------------------------------------------------
create function public.set_professional_avatar(p_professional_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.professionals%rowtype;
  o record;
  v_mime text;
  v_size bigint;
  v_old text;
begin
  select * into pr from public.professionals where id = p_professional_id;
  if pr.id is null or not private.has_role(pr.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_old := pr.avatar_path;
  if p_path is null then
    update public.professionals set avatar_path = null where id = pr.id;
    return v_old;
  end if;
  if p_path !~ ('^' || pr.barbershop_id::text || '/profissional-' || pr.id::text || '-[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$') then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  select * into o from storage.objects where bucket_id = 'site-media' and name = p_path;
  if o.name is null then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  v_mime := o.metadata ->> 'mimetype';
  v_size := (o.metadata ->> 'size')::bigint;
  if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp') or v_size is null or v_size < 1 or v_size > 2097152 then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  update public.professionals set avatar_path = p_path where id = pr.id;
  return case when v_old is distinct from p_path then v_old else null end;
end;
$$;

revoke all on function public.set_professional_avatar(uuid, text) from public, anon;
grant execute on function public.set_professional_avatar(uuid, text) to authenticated;

--------------------------------------------------------------
-- Página pública (get_public_shop da 0003 + identidade e galeria; nada de dados internos)
--------------------------------------------------------------
create or replace function public.get_public_shop(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'nome', b.nome, 'slug', b.slug, 'endereco', b.endereco, 'telefone', b.telefone, 'fuso', b.fuso,
    'descricao', b.descricao, 'cor_destaque', b.cor_destaque,
    'logo_path', (select m.storage_path from public.media_objects m where m.barbershop_id = b.id and m.kind = 'logo'),
    'capa_path', (select m.storage_path from public.media_objects m where m.barbershop_id = b.id and m.kind = 'capa'),
    'galeria', coalesce((select jsonb_agg(m.storage_path order by m.criado_em, m.id)
      from public.media_objects m where m.barbershop_id = b.id and m.kind = 'galeria'), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'descricao', s.descricao,
        'preco_centavos', s.preco_centavos, 'duracao_min', s.duracao_min) order by s.nome)
      from public.services s where s.barbershop_id = b.id and s.ativo), '[]'::jsonb),
    'professionals', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'avatar_path', p.avatar_path, 'service_ids', coalesce((
        select jsonb_agg(ps.service_id) from public.professional_services ps where ps.professional_id = p.id), '[]'::jsonb)
      ) order by p.nome)
      from public.professionals p where p.barbershop_id = b.id and p.ativo), '[]'::jsonb)
  )
  from public.barbershops b
  where b.slug = lower(btrim(p_slug)) and b.status = 'ativo'
$$;

revoke all on function
  public.save_site_profile(uuid, text, text, text, text),
  public.set_shop_slug(uuid, text),
  public.register_media(uuid, text, text),
  public.delete_media(uuid)
from public, anon;
grant execute on function
  public.save_site_profile(uuid, text, text, text, text),
  public.set_shop_slug(uuid, text),
  public.register_media(uuid, text, text),
  public.delete_media(uuid)
to authenticated;

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
  ('inicial', 'Inicial', 5, 14, 1), -- limite provisório (era 2; diferença em aplicar/diferenca-limite-equipe.sql)
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
  -- Trava a assinatura (a mesma de change_plan): ativações simultâneas na barbearia contam uma de cada vez.
  perform 1 from public.subscriptions where barbershop_id = new.barbershop_id for update;
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

-- Barberia AI — migração 0009: Google Calendar por profissional (F10-01 a F10-04)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0006. Testada localmente em supabase/tests/calendario.test.ts.
--
-- POLÍTICA (decisão registrada): sincronização UNIDIRECIONAL, Barberia AI → Google. A reserva é a fonte da verdade.
--  * Eventos criados no Google NUNCA bloqueiam horários nem viram reservas (não existe caminho de entrada).
--  * Login com Google não dá acesso ao Calendar: o vínculo exige consentimento próprio, com o escopo mínimo
--    `calendar.events`, iniciado pela própria pessoa (nem a gestão consegue vincular o calendário de alguém).
--  * Tokens ficam em tabela sem nenhum privilégio para a API; só funções de servidor (service_role) os leem.
--  * Falha do Google nunca altera a reserva: a sincronização passa pelo outbox, com tentativas e espera.
--  * Desvincular apaga o token, marca os mapeamentos e para de gerar eventos; eventos já criados no Google permanecem.

alter table public.integration_accounts drop constraint integration_accounts_provider_check;
alter table public.integration_accounts add constraint integration_accounts_provider_check check (provider in ('whatsapp', 'google_calendar'));
alter table public.outbox_events drop constraint outbox_events_canal_check;
alter table public.outbox_events add constraint outbox_events_canal_check check (canal in ('whatsapp', 'google_calendar'));

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  professional_id uuid not null unique,
  status text not null default 'aguardando_consentimento' check (status in ('aguardando_consentimento', 'ativo', 'desvinculado')),
  calendar_id text,
  escopos text[] not null default '{}',
  state_hash text,
  state_expira_em timestamptz,
  consentido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete cascade
);

-- sem nenhum privilégio para a API: somente funções security definer chamadas pelo servidor
create table public.calendar_credentials (
  professional_id uuid primary key references public.professionals(id) on delete cascade,
  refresh_token text not null,
  atualizado_em timestamptz not null default now()
);

create table public.calendar_event_links (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  connection_id uuid not null references public.calendar_connections(id) on delete cascade,
  external_event_id text,
  etag text,
  status text not null default 'sincronizado' check (status in ('sincronizado', 'removido', 'desvinculado', 'erro')),
  ultimo_erro text,
  atualizado_em timestamptz not null default now()
);
create index idx_calendar_links_connection on public.calendar_event_links (connection_id);

revoke all on table public.calendar_connections, public.calendar_credentials, public.calendar_event_links from public, anon, authenticated;
grant select (id, barbershop_id, professional_id, status, calendar_id, escopos, consentido_em, criado_em, atualizado_em)
  on public.calendar_connections to authenticated;
grant select on public.calendar_event_links to authenticated;
alter table public.calendar_connections enable row level security;
alter table public.calendar_credentials enable row level security;
alter table public.calendar_event_links enable row level security;
create policy calendar_connections_select on public.calendar_connections
  for select to authenticated
  using (private.has_role(barbershop_id, array['proprietario', 'gerente']) or private.is_my_professional(professional_id));
create policy calendar_event_links_select on public.calendar_event_links
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

--------------------------------------------------------------
-- Vínculo com consentimento (F10-01/02)
--------------------------------------------------------------
-- o próprio usuário descobre qual profissional é o dele (profile_id não é legível pela API)
create function public.my_professional(p_barbershop_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.professionals where barbershop_id = p_barbershop_id and profile_id = auth.uid() limit 1
$$;

create function public.start_calendar_link(p_professional_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_state text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select barbershop_id into v_shop from public.professionals where id = p_professional_id;
  if v_shop is null or not private.is_my_professional(p_professional_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.calendar_connections (barbershop_id, professional_id, status, state_hash, state_expira_em)
  values (v_shop, p_professional_id, 'aguardando_consentimento', encode(sha256(convert_to(v_state, 'utf8')), 'hex'), now() + interval '10 minutes')
  on conflict (professional_id) do update
    set state_hash = excluded.state_hash, state_expira_em = excluded.state_expira_em,
        status = case when public.calendar_connections.status = 'ativo' then 'ativo' else 'aguardando_consentimento' end,
        atualizado_em = now();
  return v_state;
end;
$$;

create function public.complete_calendar_link(p_state text, p_calendar_id text, p_escopos text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.calendar_connections%rowtype;
  v_events constant text := 'https://www.googleapis.com/auth/calendar.events';
begin
  select * into c from public.calendar_connections
  where state_hash = encode(sha256(convert_to(coalesce(p_state, ''), 'utf8')), 'hex') and state_expira_em > now()
  for update;
  if c.id is null then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if p_escopos is null or not (v_events = any (p_escopos)) then
    raise exception 'scope_missing' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_escopos) s where s like 'https://www.googleapis.com/auth/calendar%' and s <> v_events) then
    raise exception 'scope_too_broad' using errcode = 'P0001';
  end if;
  if p_calendar_id is null or length(btrim(p_calendar_id)) not between 1 and 200 then
    raise exception 'invalid_calendar' using errcode = 'P0001';
  end if;
  update public.calendar_connections
  set status = 'ativo', calendar_id = btrim(p_calendar_id), escopos = p_escopos, consentido_em = now(),
      state_hash = null, state_expira_em = null, atualizado_em = now()
  where id = c.id;
  return c.id;
end;
$$;

create function public.store_calendar_tokens(p_professional_id uuid, p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.calendar_credentials (professional_id, refresh_token)
  values (p_professional_id, p_refresh_token)
  on conflict (professional_id) do update set refresh_token = excluded.refresh_token, atualizado_em = now();
end;
$$;

create function public.get_calendar_refresh_token(p_professional_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select refresh_token from public.calendar_credentials where professional_id = p_professional_id
$$;

create function public.unlink_calendar(p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  select barbershop_id into v_shop from public.professionals where id = p_professional_id;
  if v_shop is null or not (private.is_my_professional(p_professional_id) or private.has_role(v_shop, array['proprietario', 'gerente'])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.calendar_credentials where professional_id = p_professional_id;
  update public.calendar_event_links set status = 'desvinculado', atualizado_em = now()
  where status = 'sincronizado' and connection_id in (select id from public.calendar_connections where professional_id = p_professional_id);
  update public.calendar_connections
  set status = 'desvinculado', escopos = '{}', state_hash = null, state_expira_em = null, atualizado_em = now()
  where professional_id = p_professional_id;
  update public.outbox_events set status = 'cancelado', ultimo_erro = 'vinculo_removido', atualizado_em = now()
  where canal = 'google_calendar' and destino = p_professional_id::text and status in ('pendente', 'bloqueado');
end;
$$;

--------------------------------------------------------------
-- Sincronização (worker): destino atual, mapeamento e idempotência (F10-03)
--------------------------------------------------------------
create function public.get_calendar_target(p_booking_id uuid)
returns table (connection_id uuid, calendar_id text, professional_id uuid, external_event_id text, link_connection_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.calendar_id, b.professional_id, l.external_event_id, l.connection_id
  from public.bookings b
  left join public.calendar_connections c on c.professional_id = b.professional_id and c.status = 'ativo'
  left join public.calendar_event_links l on l.booking_id = b.id
  where b.id = p_booking_id
$$;

create function public.complete_calendar_sync(
  p_booking_id uuid, p_connection_id uuid, p_external_event_id text, p_etag text, p_deleted boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  select barbershop_id into v_shop from public.bookings where id = p_booking_id;
  if v_shop is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.calendar_event_links (booking_id, barbershop_id, connection_id, external_event_id, etag, status)
  values (p_booking_id, v_shop, p_connection_id, p_external_event_id, p_etag, case when p_deleted then 'removido' else 'sincronizado' end)
  on conflict (booking_id) do update
    set connection_id = excluded.connection_id,
        external_event_id = coalesce(excluded.external_event_id, public.calendar_event_links.external_event_id),
        etag = coalesce(excluded.etag, public.calendar_event_links.etag),
        status = excluded.status, ultimo_erro = null, atualizado_em = now();
end;
$$;

--------------------------------------------------------------
-- Outbox: eventos de calendário a partir dos eventos da reserva (substitui a função da 0006)
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
  v_payload := jsonb_build_object(
    'booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', v_prof,
    'inicio', b.inicio, 'fim', b.fim, 'fuso', v_shop.fuso, 'barbearia', v_shop.nome, 'endereco', v_shop.endereco
  );

  if v_tipo = 'reserva_cancelada' then
    update public.outbox_events
    set status = 'cancelado', ultimo_erro = 'reserva_cancelada', atualizado_em = now()
    where booking_id = b.id and status in ('pendente', 'bloqueado')
      and (tipo like 'lembrete%' or tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_reagendada', 'calendar_upsert'));
  end if;

  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key, status, ultimo_erro)
  values (
    b.barbershop_id, b.id, b.customer_id, v_tipo, b.cliente_whatsapp, v_payload,
    b.id || ':' || v_tipo || ':' || new.id,
    case when v_consent then 'pendente' else 'cancelado' end,
    case when v_consent then null else 'sem_consentimento' end
  )
  on conflict (dedup_key) do nothing;

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

-- claim_outbox da 0006, agora exigindo a integração do CANAL do evento (whatsapp ou google_calendar)
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

  -- número que pediu PARAR não recebe nada (nem avisos da reserva): o titular do número pode não ser quem reservou
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'numero_bloqueado', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status in ('pendente', 'bloqueado')
    and exists (select 1 from public.phone_blocklist b where b.telefone = right(regexp_replace(e.destino, '\D', '', 'g'), 10));

  -- no máximo 12 mensagens por número em 24h (3 reservas × 3 avisos): a barbearia não pode virar canal de spam para terceiros
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'limite_destino', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status = 'pendente'
    and (
      select count(*) from public.outbox_events x
      where x.canal = 'whatsapp' and x.status in ('enviado', 'enviando') and x.atualizado_em > now() - interval '24 hours'
        and right(regexp_replace(x.destino, '\D', '', 'g'), 10) = right(regexp_replace(e.destino, '\D', '', 'g'), 10)
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

revoke all on function
  public.complete_calendar_link(text, text, text[]),
  public.store_calendar_tokens(uuid, text),
  public.get_calendar_refresh_token(uuid),
  public.get_calendar_target(uuid),
  public.complete_calendar_sync(uuid, uuid, text, text, boolean)
from public, anon, authenticated;
grant execute on function
  public.complete_calendar_link(text, text, text[]),
  public.store_calendar_tokens(uuid, text),
  public.get_calendar_refresh_token(uuid),
  public.get_calendar_target(uuid),
  public.complete_calendar_sync(uuid, uuid, text, text, boolean)
to service_role;
revoke all on function public.start_calendar_link(uuid), public.unlink_calendar(uuid), public.my_professional(uuid) from public, anon;
grant execute on function public.start_calendar_link(uuid), public.unlink_calendar(uuid), public.my_professional(uuid) to authenticated;

commit;
