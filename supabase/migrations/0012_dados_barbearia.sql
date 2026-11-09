--------------------------------------------------------------
-- 0012: dados da barbearia (contato, endereço estruturado e dados fiscais)
-- Um assunto só. Mudança aditiva e reversível:
--   1) barbershops ganha colunas PÚBLICAS do negócio (nome de exibição, WhatsApp, e-mail comercial, endereço em partes).
--      São dados que o site já mostra; todo membro lê, como o resto da tabela. Ninguém as grava direto (sem grant de update):
--      só a função save_shop_profile, e só proprietário/gerente da própria barbearia.
--   2) barbershop_fiscal (tabela À PARTE) guarda CPF/CNPJ, razão social, responsável e inscrição estadual. Dado pessoal (LGPD):
--      só o PROPRIETÁRIO lê e grava (RLS + função). barbershops NÃO serve para isso porque todo membro, inclusive cliente, lê a linha toda.
--   3) CPF/CNPJ são validados no servidor, com dígitos verificadores (reaproveita private.valid_cpf/valid_cnpj da 0002).
--   4) get_public_shop (mesma função da 0011) passa a devolver o nome de exibição no lugar do nome, quando existir.
-- endereco (texto único, usado pelo site e pelas mensagens) continua existindo e é MONTADO a partir das partes ao salvar:
-- uma única fonte (as partes), um único caminho de escrita.
-- Como desfazer: reaplicar get_public_shop da 0011; drop function public.save_shop_profile(...), public.save_shop_fiscal(...);
--   drop table public.barbershop_fiscal;
--   alter table public.barbershops drop column nome_exibicao, whatsapp, email_comercial, cep, logradouro, numero, complemento, bairro, cidade, uf;
--------------------------------------------------------------

alter table public.barbershops
  add column nome_exibicao text check (nome_exibicao is null or length(btrim(nome_exibicao)) between 1 and 120),
  add column whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  add column email_comercial text check (email_comercial is null or (length(email_comercial) <= 254 and email_comercial ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')),
  add column cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  add column logradouro text check (logradouro is null or length(logradouro) <= 120),
  add column numero text check (numero is null or length(numero) <= 20),
  add column complemento text check (complemento is null or length(complemento) <= 80),
  add column bairro text check (bairro is null or length(bairro) <= 80),
  add column cidade text check (cidade is null or length(cidade) <= 80),
  add column uf text check (uf is null or uf ~ '^[A-Z]{2}$');

--------------------------------------------------------------
-- Perfil da barbearia (gestão): único caminho de escrita das colunas novas, de nome, descrição, telefone e endereço
--------------------------------------------------------------
create function public.save_shop_profile(
  p_barbershop_id uuid, p_nome text, p_nome_exibicao text, p_descricao text, p_telefone text, p_whatsapp text, p_email text,
  p_cep text, p_logradouro text, p_numero text, p_complemento text, p_bairro text, p_cidade text, p_uf text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_exib text := nullif(btrim(coalesce(p_nome_exibicao, '')), '');
  v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), '');
  v_whats text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g'), '');
  v_mail text := nullif(btrim(coalesce(p_email, '')), '');
  v_cep text := nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), '');
  v_log text := nullif(btrim(coalesce(p_logradouro, '')), '');
  v_num text := nullif(btrim(coalesce(p_numero, '')), '');
  v_comp text := nullif(btrim(coalesce(p_complemento, '')), '');
  v_bai text := nullif(btrim(coalesce(p_bairro, '')), '');
  v_cid text := nullif(btrim(coalesce(p_cidade, '')), '');
  v_uf text := nullif(upper(btrim(coalesce(p_uf, ''))), '');
  v_end text;
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_nome) not between 1 and 120
     or (v_exib is not null and length(v_exib) > 120)
     or (v_desc is not null and length(v_desc) > 500)
     or (v_tel is not null and v_tel !~ '^[0-9]{10,13}$')
     or (v_whats is not null and v_whats !~ '^[0-9]{10,13}$')
     or (v_mail is not null and (length(v_mail) > 254 or v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'))
     or (v_cep is not null and v_cep !~ '^[0-9]{8}$')
     or (v_log is not null and length(v_log) > 120) or (v_num is not null and length(v_num) > 20)
     or (v_comp is not null and length(v_comp) > 80) or (v_bai is not null and length(v_bai) > 80) or (v_cid is not null and length(v_cid) > 80)
     or (v_uf is not null and v_uf !~ '^[A-Z]{2}$') then
    raise exception 'invalid_shop' using errcode = 'P0001';
  end if;
  -- texto único que o site e as mensagens já usam, montado das partes: "Rua, 123 - Bairro, Cidade - UF"
  v_end := nullif(btrim(concat_ws(', ',
    nullif(concat_ws(' - ', nullif(concat_ws(', ', v_log, v_num), ''), v_bai), ''),
    nullif(concat_ws(' - ', v_cid, v_uf), ''))), '');
  update public.barbershops
  set nome = v_nome, nome_exibicao = v_exib, descricao = v_desc, telefone = v_tel, whatsapp = v_whats, email_comercial = v_mail,
      cep = v_cep, logradouro = v_log, numero = v_num, complemento = v_comp, bairro = v_bai, cidade = v_cid, uf = v_uf,
      endereco = left(v_end, 200)
  where id = p_barbershop_id;
end;
$$;

--------------------------------------------------------------
-- Dados fiscais: tabela à parte, só o proprietário
--------------------------------------------------------------
create table public.barbershop_fiscal (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  tipo_pessoa text not null check (tipo_pessoa in ('fisica', 'juridica')),
  documento text check (documento is null or documento ~ '^([0-9]{11}|[0-9]{14})$'),
  razao_social text check (razao_social is null or length(btrim(razao_social)) between 1 and 160),
  responsavel_nome text check (responsavel_nome is null or length(btrim(responsavel_nome)) between 1 and 160),
  inscricao_estadual text check (inscricao_estadual is null or inscricao_estadual ~ '^[0-9A-Za-z./ -]{1,20}$'),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id) on delete set null
);

revoke all on table public.barbershop_fiscal from public, anon, authenticated;
grant select on public.barbershop_fiscal to authenticated;
alter table public.barbershop_fiscal enable row level security;
create policy barbershop_fiscal_select on public.barbershop_fiscal
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario']));

create function public.save_shop_fiscal(
  p_barbershop_id uuid, p_tipo text, p_documento text, p_razao_social text, p_responsavel text, p_ie text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc text := nullif(regexp_replace(coalesce(p_documento, ''), '[^0-9]', '', 'g'), '');
  v_razao text := nullif(btrim(coalesce(p_razao_social, '')), '');
  v_resp text := nullif(btrim(coalesce(p_responsavel, '')), '');
  v_ie text := nullif(btrim(coalesce(p_ie, '')), '');
begin
  if not private.has_role(p_barbershop_id, array['proprietario']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('fisica', 'juridica') then
    raise exception 'invalid_fiscal' using errcode = 'P0001';
  end if;
  if v_doc is not null and not (case when p_tipo = 'fisica' then private.valid_cpf(v_doc) else private.valid_cnpj(v_doc) end) then
    raise exception 'invalid_document' using errcode = 'P0001';
  end if;
  if (v_razao is not null and length(v_razao) > 160) or (v_resp is not null and length(v_resp) > 160)
     or (v_ie is not null and v_ie !~ '^[0-9A-Za-z./ -]{1,20}$') then
    raise exception 'invalid_fiscal' using errcode = 'P0001';
  end if;
  insert into public.barbershop_fiscal (barbershop_id, tipo_pessoa, documento, razao_social, responsavel_nome, inscricao_estadual, atualizado_por)
  values (p_barbershop_id, p_tipo, v_doc, v_razao, v_resp, v_ie, auth.uid())
  on conflict (barbershop_id) do update
  set tipo_pessoa = excluded.tipo_pessoa, documento = excluded.documento, razao_social = excluded.razao_social,
      responsavel_nome = excluded.responsavel_nome, inscricao_estadual = excluded.inscricao_estadual,
      atualizado_em = now(), atualizado_por = auth.uid();
end;
$$;

revoke all on function public.save_shop_profile(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text),
  public.save_shop_fiscal(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.save_shop_profile(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text),
  public.save_shop_fiscal(uuid, text, text, text, text, text) to authenticated;

--------------------------------------------------------------
-- Página pública: mesma função da 0011; o nome mostrado é o de exibição, quando a barbearia definiu um
--------------------------------------------------------------
create or replace function public.get_public_shop(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'nome', coalesce(b.nome_exibicao, b.nome), 'slug', b.slug, 'endereco', b.endereco, 'telefone', b.telefone, 'fuso', b.fuso,
    'descricao', b.descricao, 'cor_destaque', b.cor_destaque, 'template', b.template,
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
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'avatar_path', p.avatar_path, 'service_ids', coalesce((
        select jsonb_agg(ps.service_id) from public.professional_services ps where ps.professional_id = p.id), '[]'::jsonb)
      ) order by p.nome)
      from public.professionals p where p.barbershop_id = b.id and p.ativo), '[]'::jsonb)
  )
  from public.barbershops b
  where b.slug = lower(btrim(p_slug)) and b.status = 'ativo'
$$;
