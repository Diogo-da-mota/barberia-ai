--------------------------------------------------------------
-- 0013: documentos da barbearia (alvará, contrato social, CNPJ…), em armazenamento PRIVADO
-- Um assunto só. Mudança aditiva e reversível:
--   1) bucket `shop-documents` PRIVADO (nada de URL pública), só PDF/JPEG/PNG até 10 MB;
--   2) tabela shop_documents (metadados) e leitura só do PROPRIETÁRIO; ninguém grava direto: só as funções abaixo;
--   3) políticas do storage: só o proprietário lê, envia e apaga, e só na pasta da própria barbearia (<barbershop_id>/);
--   4) register_shop_document confere o objeto REAL no storage (prefixo, tipo e tamanho) antes de aceitar; um documento por tipo
--      (reenviar SUBSTITUI e devolve o caminho antigo para o cliente apagar), "outro" aceita até 10;
--   5) leitura por link assinado de curta duração (createSignedUrl, 60 s), gerado no momento do clique.
-- Não existe status "válido/aprovado": não há processo de verificação, então a tela só mostra o que existe (tipo, arquivo, data).
-- Como desfazer: drop function public.register_shop_document(uuid, text, text, text), public.delete_shop_document(uuid);
--   drop table public.shop_documents; drop function private.can_manage_shop_document(text);
--   apagar as políticas shop_documents_* em storage.objects; apagar os arquivos e o bucket `shop-documents`.
--------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-documents', 'shop-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

create table public.shop_documents (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  tipo text not null check (tipo in ('cnpj', 'contrato_social', 'alvara', 'inscricao_estadual', 'licenca_sanitaria', 'outro')),
  nome_arquivo text not null check (length(btrim(nome_arquivo)) between 1 and 120),
  storage_path text not null unique,
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  tamanho_bytes integer not null check (tamanho_bytes between 1 and 10485760),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);
-- um documento por tipo (reenviar substitui); "outro" pode ter vários
create unique index uq_shop_documents_tipo on public.shop_documents (barbershop_id, tipo) where tipo <> 'outro';
create index idx_shop_documents_shop on public.shop_documents (barbershop_id, criado_em);

revoke all on table public.shop_documents from public, anon, authenticated;
grant select on public.shop_documents to authenticated;
alter table public.shop_documents enable row level security;
create policy shop_documents_select on public.shop_documents
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario']));

-- o primeiro segmento do caminho precisa ser o id de uma barbearia da qual o usuário é PROPRIETÁRIO
create function private.can_manage_shop_document(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.has_role(((storage.foldername(p_name))[1])::uuid, array['proprietario'])
    else false
  end
$$;
revoke all on function private.can_manage_shop_document(text) from public, anon;
grant execute on function private.can_manage_shop_document(text) to authenticated;

create policy shop_documents_storage_select on storage.objects
  for select to authenticated using (bucket_id = 'shop-documents' and private.can_manage_shop_document(name));
create policy shop_documents_storage_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'shop-documents' and private.can_manage_shop_document(name));
create policy shop_documents_storage_delete on storage.objects
  for delete to authenticated using (bucket_id = 'shop-documents' and private.can_manage_shop_document(name));

create function public.register_shop_document(p_barbershop_id uuid, p_tipo text, p_path text, p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_mime text;
  v_size bigint;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_old text;
  v_id uuid;
begin
  if not private.has_role(p_barbershop_id, array['proprietario']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('cnpj', 'contrato_social', 'alvara', 'inscricao_estadual', 'licenca_sanitaria', 'outro')
     or length(v_nome) not between 1 and 120
     or p_path is null or p_path !~ ('^' || p_barbershop_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$') then
    raise exception 'invalid_document_file' using errcode = 'P0001';
  end if;
  select * into o from storage.objects where bucket_id = 'shop-documents' and name = p_path;
  if o.name is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  v_mime := o.metadata ->> 'mimetype';
  v_size := (o.metadata ->> 'size')::bigint;
  if v_mime is null or v_mime not in ('application/pdf', 'image/jpeg', 'image/png') or v_size is null or v_size < 1 or v_size > 10485760 then
    raise exception 'invalid_document_file' using errcode = 'P0001';
  end if;
  if p_tipo = 'outro' then
    if (select count(*) from public.shop_documents where barbershop_id = p_barbershop_id and tipo = 'outro') >= 10 then
      raise exception 'document_limit' using errcode = 'P0001';
    end if;
  else
    select storage_path into v_old from public.shop_documents where barbershop_id = p_barbershop_id and tipo = p_tipo;
    delete from public.shop_documents where barbershop_id = p_barbershop_id and tipo = p_tipo;
  end if;
  insert into public.shop_documents (barbershop_id, tipo, nome_arquivo, storage_path, mime, tamanho_bytes, criado_por)
  values (p_barbershop_id, p_tipo, v_nome, p_path, v_mime, v_size::integer, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'old_path', v_old);
end;
$$;

-- remove o registro e devolve o caminho; o cliente apaga o arquivo pela API de storage (política de delete acima)
create function public.delete_shop_document(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.shop_documents%rowtype;
begin
  select * into d from public.shop_documents where id = p_id;
  if d.id is null or not private.has_role(d.barbershop_id, array['proprietario']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.shop_documents where id = d.id;
  return d.storage_path;
end;
$$;

revoke all on function public.register_shop_document(uuid, text, text, text), public.delete_shop_document(uuid) from public, anon;
grant execute on function public.register_shop_document(uuid, text, text, text), public.delete_shop_document(uuid) to authenticated;
