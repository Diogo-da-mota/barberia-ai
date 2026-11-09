-- Barberia AI — migração 0001: identidade e multiempresa inicial (F02-02 a F02-05)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Testada localmente em supabase/tests/identidade.test.ts; ainda não aplicada no projeto remoto.
--
-- Princípios:
--  * nenhuma tabela aceita escrita direta do cliente além de campos cadastrais: criação de barbearia,
--    vínculos e convites passam por funções do servidor (security definer) que validam a identidade;
--  * o papel vale por barbearia e nunca vem de user_metadata ou de payload do cliente;
--  * as políticas consultam os vínculos por funções auxiliares, o que evita recursão de RLS.

--------------------------------------------------------------
-- Tabelas
--------------------------------------------------------------

-- Identidade do usuário (estende auth.users do Supabase Auth)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 120),
  email text,
  avatar_url text,
  criado_em timestamptz not null default now()
);

-- Estabelecimento (barbearia)
create table public.barbershops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  nome text not null check (length(btrim(nome)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  endereco text,
  telefone text,
  fuso text not null default 'America/Sao_Paulo',
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  criado_em timestamptz not null default now()
);

-- Vínculo pessoa ↔ barbearia, com papel por estabelecimento (não global)
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  papel text not null check (papel in ('proprietario', 'gerente', 'barbeiro', 'cliente')),
  criado_em timestamptz not null default now(),
  unique (barbershop_id, profile_id)
);

-- Uma barbearia tem um único proprietário
create unique index uq_memberships_proprietario on public.memberships (barbershop_id) where papel = 'proprietario';

-- Convites de membros. O token em texto puro só existe na resposta de create_invite;
-- o banco guarda apenas o hash.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  email text not null,
  papel text not null check (papel in ('gerente', 'barbeiro')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  aceito_em timestamptz,
  criado_em timestamptz not null default now()
);

-- Auditoria mínima de operações sensíveis (escrita somente pelas funções abaixo)
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid references public.barbershops(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  acao text not null,
  detalhes jsonb,
  criado_em timestamptz not null default now()
);

create index idx_memberships_profile on public.memberships (profile_id);
create index idx_memberships_barbershop on public.memberships (barbershop_id);
create index idx_invites_barbershop on public.invites (barbershop_id);
create index idx_audit_logs_barbershop on public.audit_logs (barbershop_id, criado_em desc);

--------------------------------------------------------------
-- Funções auxiliares das políticas (security definer: leem os vínculos sem passar pelo RLS)
--------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.is_member(p_barbershop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where barbershop_id = p_barbershop_id and profile_id = auth.uid()
  )
$$;

create function private.has_role(p_barbershop_id uuid, p_papeis text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where barbershop_id = p_barbershop_id and profile_id = auth.uid() and papel = any (p_papeis)
  )
$$;

revoke all on function private.is_member(uuid) from public, anon;
revoke all on function private.has_role(uuid, text[]) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, text[]) to authenticated;

--------------------------------------------------------------
-- Privilégios (o Supabase concede tudo por padrão: revogar e liberar só o necessário)
--------------------------------------------------------------
revoke all on table public.profiles, public.barbershops, public.memberships, public.invites, public.audit_logs
  from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (nome, avatar_url) on public.profiles to authenticated;

grant select on public.barbershops to authenticated;
grant update (nome, endereco, telefone, fuso) on public.barbershops to authenticated;

grant select on public.memberships to authenticated;

-- token_hash fica de fora: nenhum usuário lê o hash do convite
grant select (id, barbershop_id, email, papel, expires_at, aceito_em, criado_em) on public.invites to authenticated;

grant select on public.audit_logs to authenticated;

--------------------------------------------------------------
-- Row Level Security
--------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.barbershops enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.audit_logs enable row level security;

-- Perfis: o próprio, e os dos membros das barbearias que o usuário administra
create policy profiles_select_proprio on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_gestor on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.profile_id = profiles.id
        and private.has_role(m.barbershop_id, array['proprietario', 'gerente'])
    )
  );

create policy profiles_update_proprio on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Barbearias: membros leem; proprietário e gerente editam os dados cadastrais.
-- Sem política de INSERT/DELETE: a criação passa por create_barbershop.
create policy barbershops_select_membro on public.barbershops
  for select to authenticated
  using (private.is_member(id));

create policy barbershops_update_gestor on public.barbershops
  for update to authenticated
  using (private.has_role(id, array['proprietario', 'gerente']))
  with check (private.has_role(id, array['proprietario', 'gerente']));

-- Vínculos: cada um lê o próprio; proprietário e gerente leem os da barbearia.
-- Sem política de escrita: os vínculos nascem em create_barbershop e accept_invite.
create policy memberships_select on public.memberships
  for select to authenticated
  using (profile_id = auth.uid() or private.has_role(barbershop_id, array['proprietario', 'gerente']));

-- Convites e auditoria: somente proprietário e gerente
create policy invites_select_gestor on public.invites
  for select to authenticated
  using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

create policy audit_logs_select_gestor on public.audit_logs
  for select to authenticated
  using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

--------------------------------------------------------------
-- Perfil criado junto com a conta. O nome vem de user_metadata apenas para exibição.
--------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nome, email)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuário'
    ), 120),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

--------------------------------------------------------------
-- Operações de servidor
--------------------------------------------------------------

-- Cria a barbearia e atribui o primeiro proprietário em uma única transação.
create function public.create_barbershop(p_nome text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Garante o perfil de contas anteriores ao gatilho
  insert into public.profiles (id, nome, email)
  select u.id, left(coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Usuário'), 120), u.email
  from auth.users u
  where u.id = v_user
  on conflict (id) do nothing;

  insert into public.barbershops (owner_id, nome, slug)
  values (v_user, btrim(p_nome), lower(btrim(p_slug)))
  returning id into v_id;

  insert into public.memberships (barbershop_id, profile_id, papel)
  values (v_id, v_user, 'proprietario');

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (v_id, v_user, 'barbershop.created', jsonb_build_object('nome', btrim(p_nome), 'slug', lower(btrim(p_slug))));

  return v_id;
end;
$$;

-- Cria um convite e devolve o token UMA vez. Proprietário convida gerente ou barbeiro;
-- gerente convida apenas barbeiro.
create function public.create_invite(p_barbershop_id uuid, p_email text, p_papel text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_token text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_papel not in ('gerente', 'barbeiro') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if not (
    private.has_role(p_barbershop_id, array['proprietario'])
    or (p_papel = 'barbeiro' and private.has_role(p_barbershop_id, array['gerente']))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.invites (barbershop_id, email, papel, token_hash, expires_at)
  values (p_barbershop_id, v_email, p_papel, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), now() + interval '7 days');

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (p_barbershop_id, v_user, 'invite.created', jsonb_build_object('email', v_email, 'papel', p_papel));

  return v_token;
end;
$$;

-- Aceita um convite. O email da conta precisa estar confirmado e ser o do convite.
-- Todo motivo de recusa devolve a mesma mensagem, para não revelar se um token existe.
create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_invite public.invites%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;

  select lower(email) into v_email
  from auth.users
  where id = v_user and email_confirmed_at is not null;

  if v_invite.id is null
     or v_invite.aceito_em is not null
     or v_invite.expires_at <= now()
     or v_email is distinct from lower(v_invite.email) then
    raise exception 'invalid_invite' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.memberships where barbershop_id = v_invite.barbershop_id and profile_id = v_user
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.memberships (barbershop_id, profile_id, papel)
  values (v_invite.barbershop_id, v_user, v_invite.papel);

  update public.invites set aceito_em = now() where id = v_invite.id;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (v_invite.barbershop_id, v_user, 'invite.accepted', jsonb_build_object('papel', v_invite.papel));

  return v_invite.barbershop_id;
end;
$$;

revoke all on function public.create_barbershop(text, text) from public, anon;
revoke all on function public.create_invite(uuid, text, text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.create_barbershop(text, text) to authenticated;
grant execute on function public.create_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
