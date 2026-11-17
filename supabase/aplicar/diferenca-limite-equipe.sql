-- Diferença para o remoto (0008 já aplicada): limite provisório do plano Inicial de 2 para 5 profissionais ATIVOS
-- (inativos e gerentes não ocupam vaga, como antes) e trava contra ativações simultâneas. Nada de assinatura nova.
-- Pelo plugin do Supabase (execute_sql) ou: supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/diferenca-limite-equipe.sql
-- Reaplicar não muda nada. Conferir depois, só leitura (esperado: 5):  select max_profissionais from public.plans where id = 'inicial';
begin;

update public.plans set max_profissionais = 5 where id = 'inicial';

create or replace function private.enforce_professional_limit()
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

commit;
