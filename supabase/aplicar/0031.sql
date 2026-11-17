-- Cópia de supabase/migrations/0031_despesas_reversao.sql para o banco remoto (depois da 0030). Aplicar uma vez só, ANTES de publicar a nova tela.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0031.sql
-- Conferir depois, só leitura (esperado: true):
--   supabase db query --remote=hbkbdqctelembzqiptpi --read-only "select to_regprocedure('public.revert_expense_payment(uuid)') is not null as nova"
begin;

-- 0031: despesas — reverter pagamento, histórico, edição da paga e cadastro em lote (complemento da 0029/0030).
--
--  * Reverter pagamento (`revert_expense_payment`): a conta paga volta a 'pendente' (a tela mostra Pendente ou
--    Vencida conforme o vencimento). Nada é apagado: o razão recebe um lançamento compensatório
--    'custo_revertido' (+valor pago), então custo + reversão somam zero. Tudo em uma transação; a trava da
--    linha e a situação impedem reverter duas vezes. Lançamento antigo ('legado') e conta pendente não têm
--    pagamento registrado: a reversão é recusada. Depois da reversão a conta pode ser paga de novo.
--  * Histórico (`expense_events`): toda mudança para 'paga' e toda reversão grava uma linha com data,
--    valor, forma, quem fez e quando. É gravado por gatilho em `expenses`, então vale para qualquer caminho
--    (pay_expense, create_expense já paga, lote). Só inserção (update/delete bloqueados). Sem chave
--    estrangeira para a despesa, como `financial_ledger.ref_id`: o histórico sobrevive à exclusão da conta.
--  * `finance_report` não muda: ele soma as despesas com situação 'paga', então a conta revertida sai dos
--    custos e volta para `despesas_a_pagar_centavos` sozinha.
--  * `update_expense_details`: descrição e categoria de qualquer conta, inclusive paga ou antiga. Valor,
--    vencimento, data e forma do pagamento de uma conta paga só mudam revertendo e pagando de novo.
--  * `create_expenses`: várias despesas em uma chamada e uma transação (tudo ou nada), reaproveitando
--    `create_expense` linha a linha. Cada linha leva o id gerado na tela: repetir o envio não duplica.
--    Linha inválida devolve `invalid_expense_line:N`.
--  * Pagamentos já existentes ganham a linha de histórico correspondente (sem autor: não foi registrado).

alter table public.financial_ledger
  drop constraint financial_ledger_tipo_check,
  add constraint financial_ledger_tipo_check
    check (tipo in ('pagamento', 'estorno', 'custo', 'custo_revertido', 'comissao_provisionada', 'comissao_cancelada', 'repasse'));

create table public.expense_events (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete restrict,
  expense_id uuid not null,
  descricao text not null,
  tipo text not null check (tipo in ('pagamento', 'reversao')),
  pago_em date not null,
  valor_centavos integer not null check (valor_centavos > 0),
  forma text,
  por uuid,
  criado_em timestamptz not null default now()
);
create index idx_expense_events_expense on public.expense_events (expense_id, criado_em);

create trigger expense_events_immutable
  before update or delete on public.expense_events
  for each row execute function private.ledger_immutable();

revoke all on table public.expense_events from public, anon, authenticated;
grant select on public.expense_events to authenticated;
alter table public.expense_events enable row level security;
create policy expense_events_select on public.expense_events
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

-- pagamentos anteriores a esta migration: uma linha de histórico cada (data do registro = lançamento no razão)
insert into public.expense_events (barbershop_id, expense_id, descricao, tipo, pago_em, valor_centavos, forma, criado_em)
select e.barbershop_id, e.id, e.descricao, 'pagamento', e.pago_em, e.valor_pago_centavos, e.forma,
       coalesce((select min(l.criado_em) from public.financial_ledger l where l.ref_id = e.id and l.tipo = 'custo'), e.criado_em)
from public.expenses e
where e.situacao = 'paga';

create function private.log_expense_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.situacao = 'paga' and (tg_op = 'INSERT' or old.situacao <> 'paga') then
    insert into public.expense_events (barbershop_id, expense_id, descricao, tipo, pago_em, valor_centavos, forma, por)
    values (new.barbershop_id, new.id, new.descricao, 'pagamento', new.pago_em, new.valor_pago_centavos, new.forma, auth.uid());
  elsif tg_op = 'UPDATE' and old.situacao = 'paga' and new.situacao <> 'paga' then
    insert into public.expense_events (barbershop_id, expense_id, descricao, tipo, pago_em, valor_centavos, forma, por)
    values (old.barbershop_id, old.id, old.descricao, 'reversao', old.pago_em, old.valor_pago_centavos, old.forma, auth.uid());
  end if;
  return null;
end;
$$;
revoke all on function private.log_expense_payment() from public, anon, authenticated;

create trigger expenses_log_payment
  after insert or update of situacao on public.expenses
  for each row execute function private.log_expense_payment();

--------------------------------------------------------------
-- Reverter o pagamento de uma conta paga (correção de pagamento lançado por engano)
--------------------------------------------------------------
create function public.revert_expense_payment(p_id uuid)
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
  if e.situacao <> 'paga' then
    raise exception 'expense_not_paid' using errcode = 'P0001';
  end if;
  -- a forma fica como forma prevista; o gatilho grava a reversão no histórico com os dados do pagamento desfeito
  update public.expenses set situacao = 'pendente', pago_em = null, valor_pago_centavos = null where id = e.id;
  insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, ref_id)
  values (e.barbershop_id, 'custo_revertido', e.valor_pago_centavos, e.id);
end;
$$;

-- Descrição e categoria de qualquer conta (inclusive paga ou antiga): não mexe em valor, datas nem pagamento.
create function public.update_expense_details(p_id uuid, p_descricao text, p_categoria text)
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
  if coalesce(length(btrim(p_descricao)) not between 1 and 120 or length(btrim(p_categoria)) not between 1 and 40, true) then
    raise exception 'invalid_expense' using errcode = 'P0001';
  end if;
  update public.expenses set descricao = btrim(p_descricao), categoria = btrim(p_categoria) where id = e.id;
end;
$$;

--------------------------------------------------------------
-- Várias despesas em uma transação. Cada item: { id, descricao, categoria, valor_centavos, vencimento,
-- forma, linha_digitavel, frequencia, pago_em } (os quatro últimos podem ser nulos).
--------------------------------------------------------------
create function public.create_expenses(p_barbershop_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_n integer;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'invalid_expense_batch' using errcode = 'P0001';
  end if;
  v_n := jsonb_array_length(p_items);
  for i in 0 .. v_n - 1 loop
    v := p_items -> i;
    begin
      perform public.create_expense(
        (v ->> 'id')::uuid, p_barbershop_id, v ->> 'descricao', v ->> 'categoria', (v ->> 'valor_centavos')::integer,
        (v ->> 'vencimento')::date, v ->> 'forma', v ->> 'linha_digitavel', v ->> 'frequencia', (v ->> 'pago_em')::date, null);
    exception when raise_exception or data_exception then
      raise exception 'invalid_expense_line:%', i + 1 using errcode = 'P0001'; -- desfaz o lote inteiro
    end;
  end loop;
  return v_n;
end;
$$;

revoke all on function
  public.revert_expense_payment(uuid),
  public.update_expense_details(uuid, text, text),
  public.create_expenses(uuid, jsonb)
from public, anon;
grant execute on function
  public.revert_expense_payment(uuid),
  public.update_expense_details(uuid, text, text),
  public.create_expenses(uuid, jsonb)
to authenticated;

commit;
