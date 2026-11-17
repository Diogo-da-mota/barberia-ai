-- Cópia de supabase/migrations/0030_despesas_mes.sql para o banco remoto (depois da 0029). Aplicar uma vez só.
-- Pode ser aplicada antes ou depois de publicar a tela: sem ela, meses distantes só não mostram as contas recorrentes.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0030.sql
-- Conferir depois, só leitura (esperado: true):
--   supabase db query --remote=hbkbdqctelembzqiptpi --read-only "select to_regprocedure('public.sync_expense_recurrences(uuid, date)') is not null as nova"
begin;

-- 0030: despesas recorrentes no mês consultado (complemento da 0029).
--
--  * A aba Despesas passa a mostrar um mês por vez (vencimentos de 1º ao último dia). A 0029 só criava as
--    contas recorrentes até 35 dias à frente, então um mês distante aparecia sem o aluguel, por exemplo.
--  * `sync_expense_recurrences(barbearia, até)` cria as contas que faltam até o fim do mês consultado.
--    Limite: 24 meses (731 dias) à frente de hoje, para não gerar histórico sem fim.
--  * Mesma proteção contra duplicidade da 0029: ponteiro `geradas` sob trava + índice único
--    (recurrence_id, ocorrencia). Contas já criadas (pagas, alteradas ou excluídas) nunca são tocadas;
--    recorrência encerrada não cria nada.
--  * A função antiga de um parâmetro continua existindo (tela publicada antes desta versão) e mantém os 35 dias.
--  * Nenhum dado é alterado e `finance_report` não muda: o custo segue contando pela data real do pagamento.

create function private.generate_expense_occurrences(p_recurrence_id uuid, p_ate date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r public.expense_recurrences%rowtype;
  v_hoje date;
  v_limite date;
  v_data date;
  v_n integer := 0;
begin
  select * into r from public.expense_recurrences where id = p_recurrence_id for update;
  if r.id is null or r.encerrada_em is not null then
    return 0;
  end if;
  select (now() at time zone fuso)::date into v_hoje from public.barbershops where id = r.barbershop_id;
  v_limite := greatest(v_hoje + 35, least(coalesce(p_ate, v_hoje), v_hoje + 731));
  loop
    v_data := private.expense_occurrence(r.inicio, r.frequencia, r.geradas + v_n);
    exit when v_data > v_limite or v_n >= 400;
    insert into public.expenses (barbershop_id, descricao, categoria, valor_centavos, data, situacao, forma, recurrence_id, ocorrencia, registrado_por)
    values (r.barbershop_id, r.descricao, r.categoria, r.valor_centavos, v_data, 'pendente', r.forma, r.id, v_data, r.criado_por)
    on conflict (recurrence_id, ocorrencia) do nothing;
    v_n := v_n + 1;
  end loop;
  update public.expense_recurrences set geradas = geradas + v_n where id = r.id;
  return v_n;
end;
$$;

-- A versão de um parâmetro (usada por create_expense e pela sincronização antiga) passa a delegar: uma regra só.
create or replace function private.generate_expense_occurrences(p_recurrence_id uuid)
returns integer
language sql
set search_path = ''
as $$
  select private.generate_expense_occurrences(p_recurrence_id, null);
$$;

revoke all on function private.generate_expense_occurrences(uuid, date) from public, anon, authenticated;

create function public.sync_expense_recurrences(p_barbershop_id uuid, p_ate date)
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
    v_total := v_total + private.generate_expense_occurrences(v_id, p_ate);
  end loop;
  return v_total;
end;
$$;

revoke all on function public.sync_expense_recurrences(uuid, date) from public, anon;
grant execute on function public.sync_expense_recurrences(uuid, date) to authenticated;

commit;
