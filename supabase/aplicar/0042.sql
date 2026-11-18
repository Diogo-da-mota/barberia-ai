-- Cópia de supabase/migrations/0042_estorno_repasse_atomico.sql para o banco remoto. Troca refund_payment e create_payout (comissão travada e transição condicionada). Aplicar DEPOIS de diferenca-confirmacao-pagamento.sql e nunca reexecutá-la depois.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0042.sql
-- Conferir depois, só leitura: select position('payout_conflict' in pg_get_functiondef('public.create_payout(uuid, text)'::regprocedure)) > 0; (esperado: true)
begin;
-- Barberia AI — migração 0042: estorno e repasse simultâneos não quebram as comissões.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0005 (e de supabase/aplicar/diferenca-confirmacao-pagamento.sql, cuja
-- refund_payment é igual à da 0005). Mesmas assinaturas e permissões (create or replace). Testada em
-- supabase/tests/estorno-repasse.test.ts. Nenhum dado muda. NÃO reexecutar supabase/aplicar/diferenca-confirmacao-pagamento.sql
-- depois desta migration: ela recria refund_payment sem a trava (se acontecer, reaplicar esta migration).
--
-- Antes: refund_payment lia a comissão sem trava e a cancelava filtrando só pelo id; create_payout somava as comissões
-- provisionadas e as liquidava em comandos separados, sem travar as linhas. Como o estorno trava a reserva e o repasse trava o
-- profissional, os dois rodavam juntos: a comissão já paga num repasse virava 'cancelada' (furando a regra commission_settled)
-- ou o repasse ficava gravado sem nenhuma comissão ligada. Agora o estorno trava a comissão (for update) e só a cancela se
-- ainda estiver provisionada (senão 'commission_settled'); o repasse trava as comissões que soma e confere que liquidou
-- exatamente esse valor (senão 'payout_conflict'). Em qualquer conflito a transação inteira é desfeita.

create or replace function public.refund_payment(p_payment_id uuid, p_valor_centavos integer, p_motivo text, p_idempotency_key text)
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

  -- A comissão é travada antes de decidir: um repasse simultâneo espera este estorno terminar (ou o contrário).
  select * into c from public.commissions where booking_id = b.id for update;
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
    update public.commissions set status = 'cancelada' where id = c.id and status = 'provisionada';
    if not found then
      raise exception 'commission_settled' using errcode = 'P0001';
    end if;
    insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, professional_id, booking_id, ref_id)
    values (c.barbershop_id, 'comissao_cancelada', -c.valor_centavos, c.professional_id, c.booking_id, c.id);
  end if;
  return v_id;
end;
$$;

create or replace function public.create_payout(p_professional_id uuid, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.professionals%rowtype;
  e public.payouts%rowtype;
  v_total bigint;
  v_liquidado bigint;
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

  -- Soma e liquida o MESMO conjunto: as comissões provisionadas ficam travadas até o fim, e a soma do que foi liquidado tem
  -- de bater com o valor do repasse (um estorno simultâneo nunca deixa repasse sem comissão).
  select coalesce(sum(valor_centavos), 0) into v_total
  from (select valor_centavos from public.commissions where professional_id = pr.id and status = 'provisionada' for update) provisionadas;
  if v_total <= 0 then
    raise exception 'nothing_to_pay' using errcode = 'P0001';
  end if;
  insert into public.payouts (barbershop_id, professional_id, valor_centavos, idempotency_key, registrado_por)
  values (pr.barbershop_id, pr.id, v_total, p_idempotency_key, auth.uid())
  returning id into v_id;
  with liquidadas as (
    update public.commissions set status = 'liquidada', payout_id = v_id
    where professional_id = pr.id and status = 'provisionada'
    returning valor_centavos
  )
  select coalesce(sum(valor_centavos), 0) into v_liquidado from liquidadas;
  if v_liquidado <> v_total then
    raise exception 'payout_conflict' using errcode = 'P0001';
  end if;
  insert into public.financial_ledger (barbershop_id, tipo, valor_centavos, professional_id, ref_id)
  values (pr.barbershop_id, 'repasse', -v_total, pr.id, v_id);
  return v_id;
end;
$$;
commit;
