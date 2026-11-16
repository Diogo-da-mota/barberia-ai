-- 0023 — Fotos no AWS S3 (bucket privado, leitura pelo CloudFront), na pasta BARBEARIA/<id da barbearia>/:
--   site/logo · site/capa · site/galeria · painel/inicio · painel/agendamentos · painel/servicos · painel/sidebar ·
--   painel/financeiro · login · servicos/<id do serviço> · profissionais/<id do profissional>
-- O arquivo vai ao S3 pela Edge Function `media` (confere login, papel de gestão e o conteúdo do arquivo). O banco guarda só o
-- caminho e confere que ele está na pasta certa da barbearia. Cada posição tem UM arquivo: trocar registra o novo e devolve o
-- antigo para ser apagado. Os nomes são únicos por envio (o CDN e o navegador nunca mostram a foto antiga).
-- Também: fotos do painel e do login do cliente passam a ser registradas aqui; a galeria do site vai de 8 para 20 fotos.
-- Caminhos antigos (Supabase Storage) continuam valendo para leitura até a cópia (Edge Function `media-migrate`).
--
-- Reverter: recriar register_media(uuid, text, text) da 0007; voltar set_service_image/add_service_photo (0010) e
-- set_professional_avatar (0007); voltar o check de kind e o índice uq_media_logo_capa; apagar get_shop_login_photo e
-- private.s3_media_key.

-- 1) Tipos de foto e uma foto por posição (a galeria é a única com várias)
alter table public.media_objects drop constraint media_objects_kind_check;
alter table public.media_objects add constraint media_objects_kind_check check (kind in (
  'logo', 'capa', 'galeria',
  'painel_inicio', 'painel_agendamentos', 'painel_servicos', 'painel_sidebar', 'painel_financeiro', 'login_cliente'
));
drop index public.uq_media_logo_capa;
create unique index uq_media_posicao on public.media_objects (barbershop_id, kind) where kind <> 'galeria';

-- 2) Caminho no S3: BARBEARIA/<barbearia>/<pasta>/<uuid>.<jpg|png|webp>
create function private.s3_media_key(p_barbershop_id uuid, p_folder text, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_barbershop_id is not null and p_folder is not null and p_key is not null
    and p_key ~ ('^BARBEARIA/' || p_barbershop_id::text || '/' || p_folder
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
$$;
revoke all on function private.s3_media_key(uuid, text, text) from public;

-- 3) Fotos do site, do painel e do login: registra e devolve o caminho substituído (para apagar o arquivo)
drop function public.register_media(uuid, text, text);
create function public.register_media(p_barbershop_id uuid, p_kind text, p_path text, p_size integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folder text;
  v_old text;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_folder := case p_kind
    when 'logo' then 'site/logo' when 'capa' then 'site/capa' when 'galeria' then 'site/galeria'
    when 'painel_inicio' then 'painel/inicio' when 'painel_agendamentos' then 'painel/agendamentos'
    when 'painel_servicos' then 'painel/servicos' when 'painel_sidebar' then 'painel/sidebar'
    when 'painel_financeiro' then 'painel/financeiro' when 'login_cliente' then 'login'
  end;
  if v_folder is null or not private.s3_media_key(p_barbershop_id, v_folder, p_path)
     or p_size is null or p_size < 1 or p_size > 2097152 then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;

  if p_kind = 'galeria' then
    if (select count(*) from public.media_objects where barbershop_id = p_barbershop_id and kind = 'galeria') >= 20 then
      raise exception 'media_limit' using errcode = 'P0001';
    end if;
  else
    delete from public.media_objects where barbershop_id = p_barbershop_id and kind = p_kind returning storage_path into v_old;
  end if;
  insert into public.media_objects (barbershop_id, kind, storage_path, mime, tamanho_bytes, criado_por)
  values (p_barbershop_id, p_kind, p_path,
    case substring(p_path from '\.([a-z]+)$') when 'png' then 'image/png' when 'webp' then 'image/webp' else 'image/jpeg' end,
    p_size, auth.uid());
  return v_old;
end;
$$;
revoke all on function public.register_media(uuid, text, text, integer) from public, anon;
grant execute on function public.register_media(uuid, text, text, integer) to authenticated;

-- 4) Foto do serviço, galeria do serviço e foto do profissional: mesma regra, cada um na sua pasta
create or replace function public.set_service_image(p_service_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.services%rowtype;
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
  if not private.s3_media_key(s.barbershop_id, 'servicos/' || s.id::text, p_path) then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  update public.services set imagem_path = p_path where id = s.id;
  return case when v_old is distinct from p_path then v_old else null end;
end;
$$;

create or replace function public.add_service_photo(p_service_id uuid, p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.services%rowtype;
  v_id uuid;
  v_ordem integer;
begin
  select * into s from public.services where id = p_service_id;
  if s.id is null or not private.has_role(s.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.s3_media_key(s.barbershop_id, 'servicos/' || s.id::text, p_path) then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  select coalesce(max(ordem), -1) + 1 into v_ordem from public.service_photos where service_id = s.id;
  insert into public.service_photos (barbershop_id, service_id, storage_path, ordem)
  values (s.barbershop_id, s.id, p_path, v_ordem)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_professional_avatar(p_professional_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.professionals%rowtype;
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
  if not private.s3_media_key(pr.barbershop_id, 'profissionais/' || pr.id::text, p_path) then
    raise exception 'invalid_media' using errcode = 'P0001';
  end if;
  update public.professionals set avatar_path = p_path where id = pr.id;
  return case when v_old is distinct from p_path then v_old else null end;
end;
$$;

-- 5) Foto do login do cliente na página da barbearia (visitante sem conta): só o caminho, só de barbearia ativa
create function public.get_shop_login_photo(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.storage_path
  from public.media_objects m
  join public.barbershops b on b.id = m.barbershop_id
  where b.slug = p_slug and b.status = 'ativo' and m.kind = 'login_cliente'
$$;
revoke all on function public.get_shop_login_photo(text) from public;
grant execute on function public.get_shop_login_photo(text) to anon, authenticated;
