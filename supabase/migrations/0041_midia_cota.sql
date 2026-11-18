-- Barberia AI — migração 0041: cota de envio de fotos ao S3 por barbearia e limpeza segura dos envios órfãos.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0007, 0010 e 0023. Testada em supabase/tests/midia-s3.test.ts.
-- Nenhum dado existente muda: só cria o registro de envios e três funções do servidor (service_role).
--
-- Antes: a Edge Function media gravava no S3 qualquer arquivo de até 2 MB enviado pela gestão, com chave nova a cada chamada;
-- a contagem (galeria até 20, uma foto por posição, serviço até 5) só existia no registro feito depois pelo navegador, que quem
-- usa a API direto pode pular. Os envios nunca registrados ficavam no bucket para sempre (sem expiração e sem listagem).
-- Agora:
--   1. reserve_media_upload: a função media anota cada envio ANTES de gravar no S3 e recusa ('upload_limit') quando a barbearia
--      já fez 200 envios nas últimas 24 h ou tem 30 envios das últimas 24 h ainda sem registro (nem apagados).
--   2. mark_media_removed: a função media anota as chaves que apagou (foto substituída ou removida).
--   3. list_orphan_media: envios com mais de 24 h, não apagados e sem NENHUM registro que aponte para eles (media_objects,
--      services, service_photos, professionals). Só chaves anotadas aqui entram: imagens anteriores a esta migration e imagens
--      registradas nunca são candidatas. A limpeza (media-migrate, acao 'limpar-orfaos') apaga essas e marca como removidas.

create table public.media_uploads (
  key text primary key check (key ~ '^BARBEARIA/[0-9a-f-]{36}/' and length(key) <= 300),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  enviado_por uuid,
  criado_em timestamptz not null default now(),
  removido_em timestamptz
);
create index media_uploads_shop_idx on public.media_uploads (barbershop_id, criado_em);
alter table public.media_uploads enable row level security;
revoke all on table public.media_uploads from public, anon, authenticated;

create function private.media_key_in_use(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.media_objects where storage_path = p_key)
      or exists (select 1 from public.services where imagem_path = p_key)
      or exists (select 1 from public.service_photos where storage_path = p_key)
      or exists (select 1 from public.professionals where avatar_path = p_key)
$$;
revoke all on function private.media_key_in_use(text) from public, anon, authenticated;

create function public.reserve_media_upload(p_barbershop_id uuid, p_key text, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_barbershop_id is null or p_key is null or split_part(p_key, '/', 1) <> 'BARBEARIA' or split_part(p_key, '/', 2) <> p_barbershop_id::text
     or p_key ~ '(^|/)\.{1,2}(/|$)' or p_key like '%//%' then
    raise exception 'invalid_media' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('media_uploads:' || p_barbershop_id::text, 0));
  if (select count(*) from public.media_uploads
      where barbershop_id = p_barbershop_id and criado_em > now() - interval '24 hours') >= 200
     or (select count(*) from public.media_uploads u
         where u.barbershop_id = p_barbershop_id and u.criado_em > now() - interval '24 hours' and u.removido_em is null
           and not private.media_key_in_use(u.key)) >= 30 then
    raise exception 'upload_limit' using errcode = 'P0001';
  end if;
  insert into public.media_uploads (key, barbershop_id, enviado_por) values (p_key, p_barbershop_id, p_profile_id);
end;
$$;

create function public.mark_media_removed(p_keys text[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with feito as (
    update public.media_uploads set removido_em = now()
    where key = any(coalesce(p_keys, '{}')) and removido_em is null and not private.media_key_in_use(key)
    returning 1
  )
  select count(*)::int from feito
$$;

create function public.list_orphan_media(p_limit integer default 100)
returns table (key text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.key
  from public.media_uploads u
  where u.removido_em is null and u.criado_em < now() - interval '24 hours' and not private.media_key_in_use(u.key)
  order by u.criado_em
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

revoke all on function public.reserve_media_upload(uuid, text, uuid), public.mark_media_removed(text[]), public.list_orphan_media(integer)
  from public, anon, authenticated;
grant execute on function public.reserve_media_upload(uuid, text, uuid), public.mark_media_removed(text[]), public.list_orphan_media(integer)
  to service_role;
