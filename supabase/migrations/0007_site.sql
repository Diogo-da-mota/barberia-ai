-- Barberia AI — migração 0007: site personalizável e mídia (F09-01 a F09-04)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0004 (independe de 0005/0006). Testada localmente em supabase/tests/site.test.ts.
--
-- Personalização limitada: cor de destaque só da paleta do Design System (contraste garantido), textos curtos.
-- Mídia: bucket `site-media` (leitura pública, só imagens jpeg/png/webp até 2 MB). Escrita no storage só pela gestão
-- da própria empresa (prefixo <barbershop_id>/). register_media confere o objeto REAL no storage antes de publicar.

alter table public.barbershops
  add column descricao text check (descricao is null or length(descricao) <= 500),
  add column cor_destaque text check (cor_destaque is null or cor_destaque in ('ambar', 'azul', 'verde', 'vermelho', 'violeta'));

create table public.media_objects (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  kind text not null check (kind in ('logo', 'capa', 'galeria')),
  storage_path text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  tamanho_bytes integer not null check (tamanho_bytes between 1 and 2097152),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index uq_media_logo_capa on public.media_objects (barbershop_id, kind) where kind in ('logo', 'capa');
create index idx_media_shop on public.media_objects (barbershop_id, kind);

revoke all on table public.media_objects from public, anon, authenticated;
grant select on public.media_objects to authenticated;
alter table public.media_objects enable row level security;
create policy media_objects_select on public.media_objects
  for select to authenticated using (private.is_member(barbershop_id) and not private.has_role(barbershop_id, array['cliente']));

--------------------------------------------------------------
-- Storage: bucket e políticas
--------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- o primeiro segmento do caminho precisa ser o id de uma barbearia em que o usuário é proprietário ou gerente
create function private.can_write_site_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.has_role(((storage.foldername(p_name))[1])::uuid, array['proprietario', 'gerente'])
    else false
  end
$$;
revoke all on function private.can_write_site_media(text) from public, anon;
grant execute on function private.can_write_site_media(text) to authenticated;

create policy site_media_select on storage.objects
  for select using (bucket_id = 'site-media');
create policy site_media_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'site-media' and private.can_write_site_media(name));
create policy site_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'site-media' and private.can_write_site_media(name))
  with check (bucket_id = 'site-media' and private.can_write_site_media(name));
create policy site_media_delete on storage.objects
  for delete to authenticated using (bucket_id = 'site-media' and private.can_write_site_media(name));

--------------------------------------------------------------
-- Perfil do site e link público
--------------------------------------------------------------
create function public.save_site_profile(
  p_barbershop_id uuid, p_descricao text, p_cor text, p_endereco text, p_telefone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_end text := nullif(btrim(coalesce(p_endereco, '')), '');
  v_tel text := nullif(btrim(coalesce(p_telefone, '')), '');
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (v_desc is not null and length(v_desc) > 500)
     or (v_end is not null and length(v_end) > 200)
     or (v_tel is not null and (length(v_tel) > 20 or v_tel !~ '^[0-9()+ -]+$'))
     or (p_cor is not null and p_cor not in ('ambar', 'azul', 'verde', 'vermelho', 'violeta')) then
    raise exception 'invalid_site' using errcode = 'P0001';
  end if;
  update public.barbershops
  set descricao = v_desc, cor_destaque = p_cor, endereco = v_end, telefone = v_tel
  where id = p_barbershop_id;
end;
$$;

create function public.set_shop_slug(p_barbershop_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_barbershop_id, array['proprietario']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) not between 3 and 60 then
    raise exception 'invalid_slug' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.barbershops where slug = p_slug and id <> p_barbershop_id) then
    raise exception 'slug_taken' using errcode = '23505';
  end if;
  update public.barbershops set slug = p_slug where id = p_barbershop_id;
end;
$$;

--------------------------------------------------------------
-- Mídia: o servidor confere o objeto real, o prefixo e os limites
--------------------------------------------------------------
create function public.register_media(p_barbershop_id uuid, p_kind text, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_mime text;
  v_size bigint;
  v_id uuid;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('logo', 'capa', 'galeria')
     or p_path is null or p_path !~ ('^' || p_barbershop_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$') then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  select * into o from storage.objects where bucket_id = 'site-media' and name = p_path;
  if o.name is null then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  v_mime := o.metadata ->> 'mimetype';
  v_size := (o.metadata ->> 'size')::bigint;
  if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp') or v_size is null or v_size < 1 or v_size > 2097152 then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;

  if p_kind = 'galeria' then
    if (select count(*) from public.media_objects where barbershop_id = p_barbershop_id and kind = 'galeria') >= 8 then
      raise exception 'media_limit' using errcode = 'P0001';
    end if;
  else
    delete from public.media_objects where barbershop_id = p_barbershop_id and kind = p_kind;
  end if;
  insert into public.media_objects (barbershop_id, kind, storage_path, mime, tamanho_bytes, criado_por)
  values (p_barbershop_id, p_kind, p_path, v_mime, v_size::integer, auth.uid())
  on conflict (storage_path) do update set kind = excluded.kind
  returning id into v_id;
  return v_id;
end;
$$;

-- remove o registro e devolve o caminho; o cliente apaga o arquivo pela API de storage (política de delete acima)
create function public.delete_media(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.media_objects%rowtype;
begin
  select * into m from public.media_objects where id = p_id;
  if m.id is null or not private.has_role(m.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.media_objects where id = m.id;
  return m.storage_path;
end;
$$;

--------------------------------------------------------------
-- Foto de perfil do profissional (coluna professionals.avatar_path, criada na 0002 e liberada para leitura na 0004)
--------------------------------------------------------------
create function public.set_professional_avatar(p_professional_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.professionals%rowtype;
  o record;
  v_mime text;
  v_size bigint;
  v_old text;
begin
  select * into pr from public.professionals where id = p_professional_id;
  if pr.id is null or not private.has_role(pr.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_old := pr.avatar_path;
  if p_path is null then
    update public.professionals set avatar_path = null where id = pr.id;
    return v_old;
  end if;
  if p_path !~ ('^' || pr.barbershop_id::text || '/profissional-' || pr.id::text || '-[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$') then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  select * into o from storage.objects where bucket_id = 'site-media' and name = p_path;
  if o.name is null then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  v_mime := o.metadata ->> 'mimetype';
  v_size := (o.metadata ->> 'size')::bigint;
  if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp') or v_size is null or v_size < 1 or v_size > 2097152 then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  update public.professionals set avatar_path = p_path where id = pr.id;
  return case when v_old is distinct from p_path then v_old else null end;
end;
$$;

revoke all on function public.set_professional_avatar(uuid, text) from public, anon;
grant execute on function public.set_professional_avatar(uuid, text) to authenticated;

--------------------------------------------------------------
-- Página pública (get_public_shop da 0003 + identidade e galeria; nada de dados internos)
--------------------------------------------------------------
create or replace function public.get_public_shop(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'nome', b.nome, 'slug', b.slug, 'endereco', b.endereco, 'telefone', b.telefone, 'fuso', b.fuso,
    'descricao', b.descricao, 'cor_destaque', b.cor_destaque,
    'logo_path', (select m.storage_path from public.media_objects m where m.barbershop_id = b.id and m.kind = 'logo'),
    'capa_path', (select m.storage_path from public.media_objects m where m.barbershop_id = b.id and m.kind = 'capa'),
    'galeria', coalesce((select jsonb_agg(m.storage_path order by m.criado_em, m.id)
      from public.media_objects m where m.barbershop_id = b.id and m.kind = 'galeria'), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'descricao', s.descricao,
        'preco_centavos', s.preco_centavos, 'duracao_min', s.duracao_min) order by s.nome)
      from public.services s where s.barbershop_id = b.id and s.ativo), '[]'::jsonb),
    'professionals', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'avatar_path', p.avatar_path, 'service_ids', coalesce((
        select jsonb_agg(ps.service_id) from public.professional_services ps where ps.professional_id = p.id), '[]'::jsonb)
      ) order by p.nome)
      from public.professionals p where p.barbershop_id = b.id and p.ativo), '[]'::jsonb)
  )
  from public.barbershops b
  where b.slug = lower(btrim(p_slug)) and b.status = 'ativo'
$$;

revoke all on function
  public.save_site_profile(uuid, text, text, text, text),
  public.set_shop_slug(uuid, text),
  public.register_media(uuid, text, text),
  public.delete_media(uuid)
from public, anon;
grant execute on function
  public.save_site_profile(uuid, text, text, text, text),
  public.set_shop_slug(uuid, text),
  public.register_media(uuid, text, text),
  public.delete_media(uuid)
to authenticated;
