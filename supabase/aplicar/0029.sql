-- Cópia de supabase/migrations/0029_despesas.sql para o banco remoto (depois da 0028). Aplicar uma vez só, ANTES de publicar a nova tela.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0029.sql
-- Conferir depois, só leitura (esperado: true):
--   supabase db query --remote=hbkbdqctelembzqiptpi --read-only "select to_regprocedure('public.pay_expense(uuid, date, integer, text)') is not null as nova"
begin;

-- 0029: Despesas e contas a pagar (evolução de Financeiro › Custos).
--
--  * `expenses` ganha situação, pagamento, forma, linha digitável e vínculo com a recorrência.
--    `data` passa a ser o VENCIMENTO da conta (nos registros antigos continua sendo a data do custo).
--  * Registros antigos ficam com a situação 'legado': já estão no razão (`custo`) e seguem contando
--    como custo na própria `data`, exatamente como antes. Não viram "paga" (não há evidência do pagamento)
--    nem entram em "A pagar".
--  * Conta 'pendente' NÃO entra no razão nem em `custos_centavos`. Só `pay_expense` (ou a criação já paga)
--    lança o custo, uma única vez, pelo valor efetivamente pago, na data do pagamento.
--  * Recorrência: a regra fica no banco (`expense_recurrences`) e as contas são criadas sob demanda por
--    `sync_expense_recurrences` até 35 dias à frente (não depende de navegador aberto: o que ficou para
--    trás é criado, já vencido, na próxima leitura). Cada conta é a N-ésima a partir do início:
--    semanal = +7 dias, quinzenal = +15 dias, mensal = mesmo dia do mês; em mês sem esse dia, vale o
--    último dia do mês (31/01 → 28/02 → 31/03). Sem duplicar: ponteiro `geradas` sob trava + índice único.
--  * "Vencida" não é gravada: é a pendente com `data` anterior a hoje (fuso da barbearia), calculada na leitura.
--  * `add_expense` (antiga) continua existindo para a tela publicada antes desta versão; grava como 'legado'.

create table public.expense_recurrences (
  id uuid primary key,
  barbershop_id uuid not null references public.barbershops(id) on delete restrict,
  descricao text not null check (length(btrim(descricao)) between 1 and 120),
  categoria text not null check (length(btrim(categoria)) between 1 and 40),
  valor_centavos integer not null check (valor_centavos > 0),
  forma text check (forma in ('pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia')),
  frequencia text not null check (frequencia in ('semanal', 'quinzenal', 'mensal')),
  inicio date not null,
  geradas integer not null default 0 check (geradas >= 0),
  encerrada_em timestamptz,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index idx_expense_recurrences_shop on public.expense_recurrences (barbershop_id);

alter table public.expenses
  add column situacao text not null default 'legado' check (situacao in ('legado', 'pendente', 'paga')),
  add column pago_em date,
  add column valor_pago_centavos integer check (valor_pago_centavos > 0),
  add column forma text check (forma in ('pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia')),
  add column linha_digitavel text check (length(linha_digitavel) between 1 and 80),
  add column recurrence_id uuid references public.expense_recurrences(id) on delete restrict,
  add column ocorrencia date,
  add constraint expenses_pagamento check (
    (situacao = 'paga') = (pago_em is not null) and (situacao = 'paga') = (valor_pago_centavos is not null)
  );
create unique index uq_expenses_ocorrencia on public.expenses (recurrence_id, ocorrencia);
create index idx_expenses_shop_situacao on public.expenses (barbershop_id, situacao, pago_em);

revoke all on table public.expense_recurrences from public, anon, authenticated;
grant select on public.expense_recurrences to authenticated;
alter table public.expense_recurrences enable row level security;
create policy expense_recurrences_select on public.expense_recurrences
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

--------------------------------------------------------------
-- Apoio (sem acesso pela API)
--------------------------------------------------------------
create function private.expense_occurrence(p_inicio date, p_frequencia text, p_n integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_frequencia
    when 'semanal' then p_inicio + 7 * p_n
    when 'quinzenal' then p_inicio + 15 * p_n
    else (p_inicio + make_interval(months => p_n))::date
  end;
$$;

create function private.expense_fields_ok(p_descricao text, p_categoria text, p_valor_centavos integer, p_vencimento date, p_forma text, p_linha text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_valor_centavos > 0 and p_vencimento is not null
    and length(btrim(p_descricao)) between 1 and 120
    and length(btrim(p_categoria)) between 1 and 40
    and (p_forma is null or p_forma in ('pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia'))
    and (p_linha is null or length(btrim(p_linha)) between 1 and 80),
    false);
$$;

-- Cria as contas que faltam de UMA recorrência, até 35 dias à frente. A trava na regra serializa as chamadas.
create function private.generate_expense_occurrences(p_recurrence_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r public.expense_recurrences%rowtype;
  v_hoje date;
  v_data date;
  v_n integer := 0;
begin
  select * into r from public.expense_recurrences where id = p_recurrence_id for update;
  if r.id is null or r.encerrada_em is not null then
    return 0;
  end if;
  select (now() at time zone fuso)::date into v_hoje from public.barbershops where id = r.barbershop_id;
  loop
    v_data := private.expense_occurrence(r.inicio, r.frequencia, r.geradas + v_n);
    exit when v_data > v_hoje + 35 or v_n >= 200;
    insert into public.expenses (barbershop_id, descricao, categoria, valor_centavos, data, situacao, forma, recurrence_id, ocorrencia, registrado_por)
    values (r.barbershop_id, r.descricao, r.categoria, r.valor_centavos, v_data, 'pendente', r.forma, r.id, v_data, r.criado_por)
    on conflict (recurrence_id, ocorrencia) do nothing;
    v_n := v_n + 1;
  end loop;
  update public.expense_recurrences set geradas = geradas + v_n where id = r.id;
  return v_n;
end;
$$;

revoke all on function
  private.expense_occurrence(date, text, integer),
  private.expense_fields_ok(text, text, integer, date, text, text),
  private.generate_expense_occurrences(uuid)
from public, anon, authenticated;

--------------------------------------------------------------
-- Criar: avulsa (pendente ou já paga) ou recorrente. `p_id` vem da tela: repetir a chamada não duplica.
--------------------------------------------------------------
create function public.create_expense(
  p_id uuid, p_barbershop_id uuid, p_descricao text, p_categoria text, p_valor_centavos integer, p_vencimento date,
  p_forma text, p_linha_digitavel text, p_frequencia text, p_pago_em date, p_valor_pago_centavos integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date;
  v_linha text := nullif(btrim(p_linha_digitavel), '');
  v_pago integer := coalesce(p_valor_pago_centavos, p_valor_centavos);
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select (now() at time zone fuso)::date into v_hoje from public.barbershops where id = p_barbershop_id;
  if p_id is null
     or not private.expense_fields_ok(p_descricao, p_categoria, p_valor_centavos, p_vencimento, p_forma, v_linha)
     or p_vencimento not between v_hoje - 366 and v_hoje + 366
     or (p_frequencia is not null and (p_frequencia not in ('semanal', 'quinzenal', 'mensal') or p_pago_em is not null))
     or (p_pago_em is not null and (p_forma is null or v_pago <= 0 or p_pago_em > v_hoje)) then
    raise exception 'invalid_expense' using errcode = 'P0001';
  end if;

  if p_frequencia is not null then
    insert into public.expense_recurrences (id, barbershop_id, descricao, categoria, valor_centavos, forma, frequencia, inicio, criado_por)
    values (p_id, p_barbershop_id, btrim(p_descricao), btrim(p_categoria), p_valor_centavos, p_forma, p_frequencia, p_vencimento, auth.uid())
    on conflict (id) do nothing;
    if found then
      perform private.generate_expense_occurrences(p_id);
    end if;
    return p_id;
  end if;

  insert into public.expenses (id, barbershop_id, descricao, categoria, valor_centavos, data, situacao, forma, linha_digitavel, pago_em, valor_pago_centavos, registrado_por)
  values (p_id, p_barbershop_id, btrim(p_descricao), btrim(p_categoria), p_valor_centavos, p_vencimento,
          case when p_pago_em is null then 'pendente' else 'paga' end, p_forma, v_linha,
          p_pago_em, case when p_pago_em is null then null else v_pago end, auth.uid())
  on conflict (id) do nothing;
  if found and p_pago_em is not null then
    insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, ref_id)
    values (p_barbershop_id, 'custo', -v_pago, p_id);
  end if;
  return p_id;
end;
$$;

-- Alterar uma conta pendente (inclusive uma ocorrência da recorrência, sem mexer nas demais).
create function public.update_expense(
  p_id uuid, p_descricao text, p_categoria text, p_valor_centavos integer, p_vencimento date, p_forma text, p_linha_digitavel text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  v_linha text := nullif(btrim(p_linha_digitavel), '');
begin
  select * into e from public.expenses where id = p_id for update;
  if e.id is null or not private.has_role(e.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if e.situacao <> 'pendente' then
    raise exception 'expense_not_pending' using errcode = 'P0001';
  end if;
  if not private.expense_fields_ok(p_descricao, p_categoria, p_valor_centavos, p_vencimento, p_forma, v_linha) then
    raise exception 'invalid_expense' using errcode = 'P0001';
  end if;
  update public.expenses
  set descricao = btrim(p_descricao), categoria = btrim(p_categoria), valor_centavos = p_valor_centavos,
      data = p_vencimento, forma = p_forma, linha_digitavel = v_linha
  where id = e.id;
end;
$$;

-- Pagar: só a conta pendente; a trava da linha impede dois pagamentos da mesma conta. Só aqui o custo entra no razão.
create function public.pay_expense(p_id uuid, p_pago_em date, p_valor_pago_centavos integer, p_forma text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
  v_hoje date;
begin
  select * into e from public.expenses where id = p_id for update;
  if e.id is null or not private.has_role(e.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if e.situacao <> 'pendente' then
    raise exception 'expense_not_pending' using errcode = 'P0001';
  end if;
  select (now() at time zone fuso)::date into v_hoje from public.barbershops where id = e.barbershop_id;
  if p_pago_em is null or p_pago_em > v_hoje or p_valor_pago_centavos is null or p_valor_pago_centavos <= 0
     or p_forma is null or p_forma not in ('pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia') then
    raise exception 'invalid_expense_payment' using errcode = 'P0001';
  end if;
  update public.expenses
  set situacao = 'paga', pago_em = p_pago_em, valor_pago_centavos = p_valor_pago_centavos, forma = p_forma
  where id = e.id;
  insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, ref_id)
  values (e.barbershop_id, 'custo', -p_valor_pago_centavos, e.id);
end;
$$;

-- Excluir: só a conta pendente (nunca entrou no razão). A recorrência não recria a conta excluída.
create function public.delete_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
begin
  select * into e from public.expenses where id = p_id for update;
  if e.id is null or not private.has_role(e.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if e.situacao <> 'pendente' then
    raise exception 'expense_not_pending' using errcode = 'P0001';
  end if;
  delete from public.expenses where id = e.id;
end;
$$;

-- Encerrar a recorrência: para de criar contas e remove só as pendentes que ainda vão vencer.
-- Pagas, vencidas e a que vence hoje ficam (histórico preservado).
create function public.end_expense_recurrence(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.expense_recurrences%rowtype;
  v_hoje date;
begin
  select * into r from public.expense_recurrences where id = p_id for update;
  if r.id is null or not private.has_role(r.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if r.encerrada_em is not null then
    return;
  end if;
  select (now() at time zone fuso)::date into v_hoje from public.barbershops where id = r.barbershop_id;
  update public.expense_recurrences set encerrada_em = now() where id = r.id;
  delete from public.expenses where recurrence_id = r.id and situacao = 'pendente' and data > v_hoje;
end;
$$;

-- Cria as contas recorrentes que faltam da barbearia (chamada pela tela antes de listar).
create function public.sync_expense_recurrences(p_barbershop_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_total integer := 0;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for v_id in select id from public.expense_recurrences where barbershop_id = p_barbershop_id and encerrada_em is null order by id loop
    v_total := v_total + private.generate_expense_occurrences(v_id);
  end loop;
  return v_total;
end;
$$;

--------------------------------------------------------------
-- Relatório: custos = só o que saiu do caixa (pagas na data do pagamento + registros antigos na própria data).
-- Nova coluna `despesas_a_pagar_centavos`: pendentes com vencimento no período (obrigação, não entra no resultado).
--------------------------------------------------------------
drop function public.finance_report(uuid, date, date);
create function public.finance_report(p_barbershop_id uuid, p_de date, p_ate date)
returns table (
  previsto_centavos bigint,
  recebido_centavos bigint,
  custos_centavos bigint,
  comissoes_provisionadas_centavos bigint,
  comissoes_liquidadas_centavos bigint,
  resultado_estimado_centavos bigint,
  despesas_a_pagar_centavos bigint
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
  v_pend bigint;
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
  select coalesce(sum(case when situacao = 'paga' then valor_pago_centavos else valor_centavos end), 0) into v_cus
  from public.expenses
  where barbershop_id = p_barbershop_id
    and ((situacao = 'legado' and data between p_de and p_ate) or (situacao = 'paga' and pago_em between p_de and p_ate));
  select coalesce(sum(valor_centavos), 0) into v_pend from public.expenses
  where barbershop_id = p_barbershop_id and situacao = 'pendente' and data between p_de and p_ate;
  select coalesce(sum(valor_centavos) filter (where status = 'provisionada'), 0),
         coalesce(sum(valor_centavos) filter (where status = 'liquidada'), 0)
  into v_prov, v_liq from public.commissions
  where barbershop_id = p_barbershop_id and (criado_em at time zone v_fuso)::date between p_de and p_ate;

  return query select v_prev, v_rec, v_cus, v_prov, v_liq, v_rec - v_cus - v_prov - v_liq, v_pend;
end;
$$;

--------------------------------------------------------------
-- Permissões das funções
--------------------------------------------------------------
revoke all on function
  public.create_expense(uuid, uuid, text, text, integer, date, text, text, text, date, integer),
  public.update_expense(uuid, text, text, integer, date, text, text),
  public.pay_expense(uuid, date, integer, text),
  public.delete_expense(uuid),
  public.end_expense_recurrence(uuid),
  public.sync_expense_recurrences(uuid),
  public.finance_report(uuid, date, date)
from public, anon;
grant execute on function
  public.create_expense(uuid, uuid, text, text, integer, date, text, text, text, date, integer),
  public.update_expense(uuid, text, text, integer, date, text, text),
  public.pay_expense(uuid, date, integer, text),
  public.delete_expense(uuid),
  public.end_expense_recurrence(uuid),
  public.sync_expense_recurrences(uuid),
  public.finance_report(uuid, date, date)
to authenticated;

commit;
