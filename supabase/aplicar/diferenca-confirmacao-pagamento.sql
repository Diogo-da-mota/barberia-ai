-- Diferença para o REMOTO (0005 já aplicada): pagamento nasce "a confirmar" e só entra no caixa ao confirmar.
-- Rodar: supabase db query --remote --yes -f supabase/aplicar/diferenca-confirmacao-pagamento.sql
begin;

alter table public.payments
  add column if not exists confirmado_em timestamptz,
  add column if not exists confirmado_por uuid references public.profiles(id) on delete set null;
-- os pagamentos que já existem entraram no caixa na hora: ficam confirmados na data em que foram registrados
update public.payments set confirmado_em = criado_em where confirmado_em is null;

create or replace function public.register_payment(
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

create or replace function public.confirm_payment(p_payment_id uuid)
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

create or replace function public.discard_payment(p_payment_id uuid)
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

revoke all on function public.confirm_payment(uuid), public.discard_payment(uuid) from public, anon;
grant execute on function public.confirm_payment(uuid), public.discard_payment(uuid) to authenticated;

commit;
