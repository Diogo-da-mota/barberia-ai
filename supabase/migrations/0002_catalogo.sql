-- Barberia AI — migração 0002: catálogo e equipe (F03-01, F03-02)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende da 0001. Testada localmente em supabase/tests/catalogo.test.ts.
--
-- Valores em centavos inteiros. As chaves estrangeiras compostas impedem ligar um profissional
-- a um serviço de outra barbearia, mesmo que a aplicação tente.

create table public.services (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  descricao text check (descricao is null or length(descricao) <= 300),
  preco_centavos integer not null check (preco_centavos between 0 and 10000000),
  duracao_min integer not null check (duracao_min between 5 and 480),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (id, barbershop_id),
  unique (barbershop_id, nome)
);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  -- foto de perfil (caminho no bucket de mídia; gravada por set_professional_avatar, 0007)
  avatar_path text check (avatar_path is null or length(avatar_path) <= 300),
  -- contato: SÓ a gestão lê/grava (get_professional_contacts / save_professional_contact); nunca liberado por coluna na API
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,11}$'),
  email text check (email is null or (length(email) <= 160 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  documento text check (documento is null or documento ~ '^([0-9]{11}|[0-9]{14})$'),
  unique (id, barbershop_id),
  unique (barbershop_id, nome)
);

create table public.professional_services (
  barbershop_id uuid not null,
  professional_id uuid not null,
  service_id uuid not null,
  primary key (professional_id, service_id),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete cascade,
  foreign key (service_id, barbershop_id) references public.services (id, barbershop_id) on delete cascade
);

create index idx_services_barbershop on public.services (barbershop_id);
create index idx_professionals_barbershop on public.professionals (barbershop_id);
create index idx_professional_services_service on public.professional_services (service_id);

--------------------------------------------------------------
-- Privilégios
--------------------------------------------------------------
revoke all on table public.services, public.professionals, public.professional_services
  from public, anon, authenticated;

grant select on public.services, public.professionals, public.professional_services to authenticated;

-- barbershop_id só é definido na criação; depois não muda
grant insert (barbershop_id, nome, descricao, preco_centavos, duracao_min, ativo) on public.services to authenticated;
grant update (nome, descricao, preco_centavos, duracao_min, ativo) on public.services to authenticated;
grant delete on public.services to authenticated;

-- Profissionais são criados e alterados por save_professional, que mantém os serviços em uma transação
grant delete on public.professionals to authenticated;

--------------------------------------------------------------
-- Row Level Security: membros leem; proprietário e gerente escrevem
--------------------------------------------------------------
alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_services enable row level security;

create policy services_select on public.services
  for select to authenticated using (private.is_member(barbershop_id));
create policy services_insert on public.services
  for insert to authenticated with check (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy services_update on public.services
  for update to authenticated
  using (private.has_role(barbershop_id, array['proprietario', 'gerente']))
  with check (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy services_delete on public.services
  for delete to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

create policy professionals_select on public.professionals
  for select to authenticated using (private.is_member(barbershop_id));
create policy professionals_delete on public.professionals
  for delete to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

create policy professional_services_select on public.professional_services
  for select to authenticated using (private.is_member(barbershop_id));

--------------------------------------------------------------
-- Operação de servidor: criar ou atualizar um profissional com seus serviços
--------------------------------------------------------------
create function public.save_professional(
  p_barbershop_id uuid,
  p_id uuid,
  p_nome text,
  p_ativo boolean,
  p_service_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := p_id;
  v_ids uuid[] := coalesce(array(select distinct unnest(p_service_ids)), '{}');
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if (select count(*) from public.services where barbershop_id = p_barbershop_id and id = any (v_ids))
     <> coalesce(cardinality(v_ids), 0) then
    raise exception 'invalid_service' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.professionals (barbershop_id, nome, ativo)
    values (p_barbershop_id, btrim(p_nome), coalesce(p_ativo, true))
    returning id into v_id;
  else
    update public.professionals
    set nome = btrim(p_nome), ativo = coalesce(p_ativo, true)
    where id = v_id and barbershop_id = p_barbershop_id;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.professional_services
  where professional_id = v_id and not (service_id = any (v_ids));

  insert into public.professional_services (barbershop_id, professional_id, service_id)
  select p_barbershop_id, v_id, unnest(v_ids)
  on conflict do nothing;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (p_barbershop_id, v_user, 'professional.saved', jsonb_build_object('professional_id', v_id));

  return v_id;
end;
$$;

revoke all on function public.save_professional(uuid, uuid, text, boolean, uuid[]) from public, anon;
grant execute on function public.save_professional(uuid, uuid, text, boolean, uuid[]) to authenticated;

--------------------------------------------------------------
-- Contato do profissional: telefone (Brasil), e-mail e CPF ou CNPJ
-- Só a gestão da barbearia lê e grava, por função. As colunas NÃO são liberadas para leitura direta na API (0004).
--------------------------------------------------------------
create function private.valid_cpf(p_doc text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d int[];
  v_soma int;
  v_dv int;
  i int;
begin
  if p_doc is null or p_doc !~ '^[0-9]{11}$' or p_doc ~ '^(.)\1{10}$' then
    return false;
  end if;
  d := array(select substr(p_doc, n, 1)::int from generate_series(1, 11) n);
  for k in 1..2 loop
    v_soma := 0;
    for i in 1..(8 + k) loop
      v_soma := v_soma + d[i] * (10 + k - i);
    end loop;
    v_dv := (v_soma * 10) % 11 % 10;
    if v_dv <> d[9 + k] then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create function private.valid_cnpj(p_doc text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d int[];
  w1 constant int[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  w2 constant int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  v_soma int;
  v_r int;
  v_dv int;
  i int;
begin
  if p_doc is null or p_doc !~ '^[0-9]{14}$' or p_doc ~ '^(.)\1{13}$' then
    return false;
  end if;
  d := array(select substr(p_doc, n, 1)::int from generate_series(1, 14) n);
  v_soma := 0;
  for i in 1..12 loop v_soma := v_soma + d[i] * w1[i]; end loop;
  v_r := v_soma % 11;
  v_dv := case when v_r < 2 then 0 else 11 - v_r end;
  if d[13] <> v_dv then
    return false;
  end if;
  v_soma := 0;
  for i in 1..13 loop v_soma := v_soma + d[i] * w2[i]; end loop;
  v_r := v_soma % 11;
  v_dv := case when v_r < 2 then 0 else 11 - v_r end;
  return d[14] = v_dv;
end;
$$;

revoke all on function private.valid_cpf(text), private.valid_cnpj(text) from public, anon, authenticated;

create function public.save_professional_contact(p_professional_id uuid, p_telefone text, p_email text, p_documento text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  select barbershop_id into v_shop from public.professionals where id = p_professional_id;
  if v_shop is null or not private.has_role(v_shop, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- telefone: +55 DD NNNN-NNNN ou DD NNNN-NNNN (fixo de 8 dígitos, começando de 2 a 5, ou celular de 9 dígitos, começando em 9); guarda só os dígitos, sem o 55
  if length(v_tel) in (12, 13) and left(v_tel, 2) = '55' then
    v_tel := substr(v_tel, 3);
  end if;
  if v_tel = '' and btrim(coalesce(p_telefone, '')) <> '' then
    raise exception 'invalid_phone' using errcode = 'P0001'; -- texto sem nenhum dígito não é "campo vazio"
  elsif v_tel = '' then
    v_tel := null;
  elsif v_tel !~ '^[1-9][1-9](9[0-9]{8}|[2-5][0-9]{7})$' then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if v_email is not null and (length(v_email) > 160 or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  if v_doc = '' and btrim(coalesce(p_documento, '')) <> '' then
    raise exception 'invalid_document' using errcode = 'P0001';
  elsif v_doc = '' then
    v_doc := null;
  elsif not (private.valid_cpf(v_doc) or private.valid_cnpj(v_doc)) then
    raise exception 'invalid_document' using errcode = 'P0001';
  end if;
  update public.professionals set telefone = v_tel, email = lower(v_email), documento = v_doc where id = p_professional_id;
  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (v_shop, auth.uid(), 'professional.contact_saved', jsonb_build_object('professional_id', p_professional_id));
end;
$$;

create function public.get_professional_contacts(p_barbershop_id uuid)
returns table (professional_id uuid, telefone text, email text, documento text)
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
  select p.id, p.telefone, p.email, p.documento from public.professionals p where p.barbershop_id = p_barbershop_id;
end;
$$;

revoke all on function public.save_professional_contact(uuid, text, text, text), public.get_professional_contacts(uuid) from public, anon;
grant execute on function public.save_professional_contact(uuid, text, text, text), public.get_professional_contacts(uuid) to authenticated;
