-- Cópia de supabase/migrations/0049_limite_reservas_equipe_ativa.sql para o banco remoto. Troca só public.create_booking: isenção do limite de 10 reservas/24 h exige proprietário, gerente ou card ativo ligado à conta.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0049.sql
-- Conferir depois, só leitura: select position('my_professional(p_barbershop_id) is not null' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'create_booking'; (esperado: true)
begin;
-- Barberia AI — migração 0049: barbeiro desligado não fica isento do limite de 10 reservas em 24 h.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0021 e 0038. Testada em supabase/tests/desligamento-equipe.test.ts.
-- Nenhum dado muda: só troca public.create_booking (cópia da 0021, igual à do remoto conferida em 2026-11-17), mudando apenas a
-- condição da isenção.
--
-- Antes: a isenção valia para qualquer conta com o papel 'barbeiro' na barbearia. Card com histórico não pode ser excluído, então
-- o barbeiro desligado (card desativado pela gestão) mantinha o papel e reservava sem o limite de 10 em 24 h que vale para os
-- clientes. Agora a isenção exige proprietário/gerente ou card ativo ligado à conta. Histórico, reservas e o papel ficam como
-- estão; o limite de 3 reservas futuras e as demais regras não mudam.

create or replace function public.create_booking(
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

  -- Serializa as reservas do mesmo cliente (em todas as barbearias) para os limites valerem sob concorrência
  perform pg_advisory_xact_lock(hashtextextended('create_booking:' || v_user::text, 0));
  if (select count(*) from public.bookings
      where barbershop_id = p_barbershop_id and customer_id = v_user
        and status in ('pendente', 'confirmado') and inicio > now()) >= 3 then
    raise exception 'booking_limit' using errcode = 'P0001';
  end if;
  -- Limite por conta: 10 reservas criadas em 24 h (canceladas contam). Isentos nesta barbearia: proprietário, gerente e quem tem
  -- card de profissional ATIVO ligado à conta (my_professional, 0038). Barbeiro com o card desativado volta ao limite.
  if not (private.has_role(p_barbershop_id, array['proprietario', 'gerente']) or public.my_professional(p_barbershop_id) is not null)
     and (select count(*) from public.bookings
          where customer_id = v_user and criado_em > now() - interval '24 hours') >= 10 then
    raise exception 'booking_rate_limited' using errcode = 'P0001';
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
commit;
