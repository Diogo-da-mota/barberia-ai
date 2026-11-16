-- Barberia AI — diferença da 0003 (agenda): grade de horários livres e ocupados (public.get_slot_grid).
-- Só cria uma função NOVA de leitura. Não altera tabelas, dados, get_availability, create_booking nem reschedule_booking.
-- Pode rodar mais de uma vez (create or replace). Rodar no Supabase SQL Editor (projeto hbkbdqctelembzqiptpi).
-- Desfazer: drop function public.get_slot_grid(uuid, uuid, date, uuid);
begin;

create or replace function public.get_slot_grid(p_barbershop_id uuid, p_service_id uuid, p_data date, p_booking_id uuid default null)
returns table (prof_id uuid, prof_nome text, slot_inicio timestamptz, livre boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_dur integer;
  v_propria uuid;
begin
  select b.fuso into v_tz from public.barbershops b where b.id = p_barbershop_id and b.status = 'ativo';
  select sv.duracao_min into v_dur from public.services sv where sv.id = p_service_id and sv.barbershop_id = p_barbershop_id and sv.ativo;
  if v_tz is null or v_dur is null or p_data is null
     or p_data < (now() at time zone v_tz)::date or p_data > (now() at time zone v_tz)::date + 60 then
    return;
  end if;
  if p_booking_id is not null then
    select bk.occupancy_id into v_propria from public.bookings bk
    where bk.id = p_booking_id and bk.barbershop_id = p_barbershop_id
      and (bk.customer_id = auth.uid() or private.has_role(p_barbershop_id, array['proprietario', 'gerente']));
  end if;

  return query
  select pr.id, pr.nome, gs, not exists (
      select 1 from public.occupancies o
      where o.professional_id = pr.id and o.id is distinct from v_propria
        and o.periodo && tstzrange(gs, gs + make_interval(mins => v_dur), '[)')
    )
  from public.professionals pr
  join public.professional_services ps on ps.professional_id = pr.id and ps.service_id = p_service_id
  join public.working_hours wh on wh.professional_id = pr.id and wh.dow = extract(dow from p_data)::int
  cross join lateral generate_series(
    (p_data::timestamp + make_interval(mins => wh.inicio_min)) at time zone v_tz,
    (p_data::timestamp + make_interval(mins => wh.fim_min - v_dur)) at time zone v_tz,
    interval '15 minutes'
  ) gs
  where pr.barbershop_id = p_barbershop_id
    and pr.ativo
    and wh.fim_min - wh.inicio_min >= v_dur
    and gs >= now()
  order by gs, pr.nome;
end;
$$;

revoke all on function public.get_slot_grid(uuid, uuid, date, uuid) from public, anon;
grant execute on function public.get_slot_grid(uuid, uuid, date, uuid) to anon, authenticated;

commit;

-- Conferência (só leitura): Francisco Penha em 17/11/2026, serviço Cabelo. Esperado: 08:45, 09:00 e 09:15 com livre = false.
-- select to_char(slot_inicio at time zone 'America/Sao_Paulo', 'HH24:MI') hora, prof_nome, livre
-- from public.get_slot_grid(
--   (select id from public.barbershops where slug = 'babearia-do-tico'),
--   (select s.id from public.services s join public.barbershops b on b.id = s.barbershop_id where b.slug = 'babearia-do-tico' and s.nome = 'Cabelo'),
--   date '2026-11-17')
-- where slot_inicio at time zone 'America/Sao_Paulo' < '2026-11-17 10:00' order by 1, 2;
