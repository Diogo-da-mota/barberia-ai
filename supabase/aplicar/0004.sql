-- Aplica somente a migration 0004 (agenda do barbeiro) em uma única transação.
begin;
-- Barberia AI — migração 0004: agenda própria do barbeiro (F06-03)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0003. Testada localmente em supabase/tests/barbeiro.test.ts.
--
-- O vínculo entre profissional e conta é feito só pela gestão e só com quem já é barbeiro da barbearia.
-- O barbeiro vê e atende apenas as reservas e bloqueios do profissional ligado à sua conta.

alter table public.professionals add column profile_id uuid references public.profiles(id) on delete set null;
create unique index uq_professionals_profile on public.professionals (barbershop_id, profile_id) where profile_id is not null;

-- profile_id não é legível por clientes nem por colegas: a gestão o consulta por get_team_links
revoke select on public.professionals from authenticated;
grant select (id, barbershop_id, nome, ativo, criado_em) on public.professionals to authenticated;

create function private.is_my_professional(p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.professionals where id = p_professional_id and profile_id = auth.uid()
  )
$$;

revoke all on function private.is_my_professional(uuid) from public, anon;
grant execute on function private.is_my_professional(uuid) to authenticated;

drop policy bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (
    customer_id = auth.uid()
    or private.has_role(barbershop_id, array['proprietario', 'gerente'])
    or private.is_my_professional(professional_id)
  );

drop policy occupancies_select on public.occupancies;
create policy occupancies_select on public.occupancies
  for select to authenticated
  using (
    private.has_role(barbershop_id, array['proprietario', 'gerente'])
    or private.is_my_professional(professional_id)
  );

create function public.link_professional(p_professional_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  select barbershop_id into v_shop from public.professionals where id = p_professional_id;
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_shop is null or not private.has_role(v_shop, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_profile_id is not null and not exists (
    select 1 from public.memberships where barbershop_id = v_shop and profile_id = p_profile_id and papel = 'barbeiro'
  ) then
    raise exception 'invalid_profile' using errcode = '22023';
  end if;

  begin
    update public.professionals set profile_id = p_profile_id where id = p_professional_id;
  exception when unique_violation then
    raise exception 'already_linked' using errcode = '23505';
  end;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (v_shop, auth.uid(), 'professional.linked', jsonb_build_object('professional_id', p_professional_id, 'profile_id', p_profile_id));
end;
$$;

create function public.get_team_links(p_barbershop_id uuid)
returns table (professional_id uuid, profile_id uuid, profile_nome text, profile_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.profile_id, pr.nome, pr.email
  from public.professionals p
  join public.profiles pr on pr.id = p.profile_id
  where p.barbershop_id = p_barbershop_id
    and p.profile_id is not null
    and private.has_role(p_barbershop_id, array['proprietario', 'gerente'])
$$;

-- O barbeiro conclui ou marca falta apenas nos próprios atendimentos; confirmar continua com a gestão
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
end;
$$;

revoke all on function public.link_professional(uuid, uuid), public.get_team_links(uuid) from public, anon;
grant execute on function public.link_professional(uuid, uuid), public.get_team_links(uuid) to authenticated;

commit;
