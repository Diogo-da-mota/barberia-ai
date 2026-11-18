-- Cópia de supabase/migrations/0050_midia_limpeza_reserva.sql para o banco remoto. Reserva antes de apagar (list_orphan_media) e trava de cadastro nas 4 tabelas com imagens. Aplicar ANTES da 0051.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0050.sql
-- Conferir depois, só leitura: select count(*) from pg_trigger where tgname like '%media_guard'; (esperado: 4)
begin;
-- Barberia AI — migração 0050: a limpeza dos envios órfãos reserva cada arquivo no banco ANTES de apagá-lo no S3.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0007, 0010, 0023 e 0041. Testada em supabase/tests/limpeza-midia.test.ts.
-- Nenhum dado muda: cria uma coluna vazia, troca list_orphan_media e cria um gatilho de conferência nas 4 tabelas com imagens.
-- A Edge Function media-migrate NÃO muda (continua: list_orphan_media → apagar no S3 → mark_media_removed).
--
-- Antes: list_orphan_media só lia. Entre a lista e a exclusão no S3, um cadastro da mesma chave (register_media,
-- set_service_image, add_service_photo, set_professional_avatar) era aceito; o arquivo era apagado mesmo assim e
-- mark_media_removed pulava a chave (agora em uso): a imagem ficava cadastrada sem arquivo.
-- Agora:
--   1. list_orphan_media RESERVA o que devolve (media_uploads.limpeza_em): para cada candidato, trava a chave e confere de novo,
--      depois da trava, que segue anotada, com mais de 24 h, não apagada, não reservada e sem NENHUM registro. Só as reservadas
--      são devolvidas (e só elas são apagadas). Reserva com mais de 1 h sem remoção (falha no S3) volta a ser candidata.
--   2. Gatilho nas 4 tabelas: cadastrar uma chave anotada que já foi reservada pela limpeza ou removida é recusado
--      ('media_removed'); a mesma trava por chave serializa cadastro e reserva. Chaves não anotadas (imagens anteriores à 0041,
--      cópias do Supabase) seguem livres, e elas nunca são candidatas à limpeza.

alter table public.media_uploads add column limpeza_em timestamptz;

create or replace function public.list_orphan_media(p_limit integer default 100)
returns table (key text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  for v_key in
    select u.key
    from public.media_uploads u
    where u.removido_em is null and u.criado_em < now() - interval '24 hours'
      and (u.limpeza_em is null or u.limpeza_em < now() - interval '1 hour')
      and not private.media_key_in_use(u.key)
    order by u.criado_em
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  loop
    -- Mesma trava do gatilho de cadastro: quem chegar depois espera e relê o que o outro gravou.
    perform pg_advisory_xact_lock(hashtextextended('media_key:' || v_key, 0));
    update public.media_uploads u set limpeza_em = now()
    where u.key = v_key and u.removido_em is null and u.criado_em < now() - interval '24 hours'
      and (u.limpeza_em is null or u.limpeza_em < now() - interval '1 hour')
      and not private.media_key_in_use(u.key);
    if found then
      key := v_key;
      return next;
    end if;
  end loop;
end;
$$;

create function private.media_guard_register()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := to_jsonb(new) ->> tg_argv[0];
begin
  if v_key is null or v_key not like 'BARBEARIA/%' then
    return new;
  end if;
  if tg_op = 'UPDATE' and v_key is not distinct from (to_jsonb(old) ->> tg_argv[0]) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('media_key:' || v_key, 0));
  if exists (select 1 from public.media_uploads u where u.key = v_key and (u.removido_em is not null or u.limpeza_em is not null)) then
    raise exception 'media_removed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.media_guard_register() from public, anon, authenticated;

create trigger media_objects_media_guard before insert or update of storage_path on public.media_objects
  for each row execute function private.media_guard_register('storage_path');
create trigger services_media_guard before insert or update of imagem_path on public.services
  for each row execute function private.media_guard_register('imagem_path');
create trigger service_photos_media_guard before insert or update of storage_path on public.service_photos
  for each row execute function private.media_guard_register('storage_path');
create trigger professionals_media_guard before insert or update of avatar_path on public.professionals
  for each row execute function private.media_guard_register('avatar_path');
commit;
