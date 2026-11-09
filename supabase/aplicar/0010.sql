-- Aplica a migration 0010 (fotos do serviço: imagem e galeria de até 5) em uma única transação.
-- JÁ APLICADA NO BANCO REMOTO (06/11/2026). Use este arquivo só em um banco novo: reaplicar no remoto falha (objetos já existem).
begin;

-- Barberia AI — migração 0010: fotos do serviço (imagem principal + galeria de até 5 fotos)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0009. Testada localmente em supabase/tests/servico-imagem.test.ts e galeria-perfil.test.ts.
--
-- Assunto único: imagens do SERVIÇO. As imagens ficam no bucket `site-media` (política já existente: só a gestão grava
-- no próprio prefixo <barbershop_id>/). O cliente nunca grava o caminho direto: as funções conferem o objeto real
-- (tipo, tamanho, prefixo e nome ligado ao serviço). Foto do profissional fica na 0011.

alter table public.services
  add column imagem_path text check (imagem_path is null or length(imagem_path) <= 300);

create function public.set_service_image(p_service_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.services%rowtype;
  o record;
  v_mime text;
  v_size bigint;
  v_old text;
begin
  select * into s from public.services where id = p_service_id;
  if s.id is null or not private.has_role(s.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_old := s.imagem_path;
  if p_path is null then
    update public.services set imagem_path = null where id = s.id;
    return v_old;
  end if;
  if p_path !~ ('^' || s.barbershop_id::text || '/servico-' || s.id::text || '-[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$') then
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
  update public.services set imagem_path = p_path where id = s.id;
  return case when v_old is distinct from p_path then v_old else null end;
end;
$$;

revoke all on function public.set_service_image(uuid, text) from public, anon;
grant execute on function public.set_service_image(uuid, text) to authenticated;

--------------------------------------------------------------
-- Galeria do serviço: até 5 fotos, ordenadas
--------------------------------------------------------------
create table public.service_photos (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  service_id uuid not null,
  storage_path text not null unique check (length(storage_path) <= 300),
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  foreign key (service_id, barbershop_id) references public.services (id, barbershop_id) on delete cascade
);
create index idx_service_photos_service on public.service_photos (service_id, ordem);

create function private.enforce_service_photo_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.service_photos where service_id = new.service_id) >= 5 then
    raise exception 'photo_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger service_photos_limit before insert on public.service_photos
  for each row execute function private.enforce_service_photo_limit();

revoke all on table public.service_photos from public, anon, authenticated;
grant select on table public.service_photos to authenticated;
alter table public.service_photos enable row level security;
create policy service_photos_select on public.service_photos
  for select to authenticated using (private.is_member(barbershop_id));

create function public.add_service_photo(p_service_id uuid, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.services%rowtype;
  o record;
  v_mime text;
  v_size bigint;
  v_id uuid;
  v_ordem integer;
begin
  select * into s from public.services where id = p_service_id;
  if s.id is null or not private.has_role(s.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_path is null or p_path !~ ('^' || s.barbershop_id::text || '/servico-' || s.id::text || '-[A-Za-z0-9_-]{1,40}\.(jpg|png|webp)$') then
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
  select coalesce(max(ordem), -1) + 1 into v_ordem from public.service_photos where service_id = s.id;
  insert into public.service_photos (barbershop_id, service_id, storage_path, ordem)
  values (s.barbershop_id, s.id, p_path, v_ordem)
  returning id into v_id;
  return v_id;
end;
$$;

-- remove a foto e devolve o caminho para a API apagar o arquivo; mantém a ordem das demais
create function public.remove_service_photo(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.service_photos%rowtype;
begin
  select * into f from public.service_photos where id = p_id;
  if f.id is null or not private.has_role(f.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.service_photos where id = f.id;
  return f.storage_path;
end;
$$;

--------------------------------------------------------------
-- Página pública: imagem e galeria de cada serviço (mesma função da 0007, com imagem_path e fotos)
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
        'preco_centavos', s.preco_centavos, 'duracao_min', s.duracao_min, 'imagem_path', s.imagem_path,
        'fotos', coalesce((select jsonb_agg(f.storage_path order by f.ordem, f.criado_em)
          from public.service_photos f where f.service_id = s.id), '[]'::jsonb)) order by s.nome)
      from public.services s where s.barbershop_id = b.id and s.ativo), '[]'::jsonb),
    'professionals', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'service_ids', coalesce((
        select jsonb_agg(ps.service_id) from public.professional_services ps where ps.professional_id = p.id), '[]'::jsonb)
      ) order by p.nome)
      from public.professionals p where p.barbershop_id = b.id and p.ativo), '[]'::jsonb)
  )
  from public.barbershops b
  where b.slug = lower(btrim(p_slug)) and b.status = 'ativo'
$$;

revoke all on function
  public.set_service_image(uuid, text),
  public.add_service_photo(uuid, text),
  public.remove_service_photo(uuid)
from public, anon;
grant execute on function
  public.set_service_image(uuid, text),
  public.add_service_photo(uuid, text),
  public.remove_service_photo(uuid)
to authenticated;

commit;
