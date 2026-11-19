-- Barberia AI — migração 0052: envio direto ao Storage do Supabase com limite (achado C2 da auditoria run-3).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0007 e 0013. Testada em supabase/tests/dados-documentos.test.ts.
-- Nenhum dado muda: só políticas de storage.objects.
--
-- Antes: o proprietário ou gerente gravava quantos arquivos quisesse direto pela API do Storage (bucket público site-media e
-- privado shop-documents), fora da cota e da limpeza da 0041 (as fotos agora vão para o S3 pela função media).
-- Agora: o bucket antigo site-media não aceita envio nem troca de arquivo (o app só lê e apaga o que restou, até a
-- 'apagar-antigas'); em shop-documents o proprietário segue enviando, até 20 arquivos por barbearia (o app guarda no
-- máximo 5 tipos + 10 'outro' e sobe o novo antes de apagar o substituído).

drop policy site_media_insert on storage.objects;
drop policy site_media_update on storage.objects;

-- mesmas regras de can_manage_shop_document + no máximo 20 arquivos na pasta da barbearia
create function private.can_upload_shop_document(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_shop_document(p_name)
    and (
      select count(*) from storage.objects o
      where o.bucket_id = 'shop-documents' and o.name like (storage.foldername(p_name))[1] || '/%'
    ) < 20
$$;
revoke all on function private.can_upload_shop_document(text) from public, anon;
grant execute on function private.can_upload_shop_document(text) to authenticated;

drop policy shop_documents_storage_insert on storage.objects;
create policy shop_documents_storage_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'shop-documents' and private.can_upload_shop_document(name));
