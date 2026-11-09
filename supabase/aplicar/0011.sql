--------------------------------------------------------------
-- 0011: modelo (template) do site público de cada barbearia
-- Um assunto só: escolher entre cinco apresentações para a MESMA página (reserva, serviços e equipe não mudam).
-- Mudança mínima e reversível:
--   1) coluna barbershops.template (padrão 'urbano', só cinco valores aceitos; barbearias existentes ficam em 'urbano');
--   2) save_site_template: só proprietário/gerente da própria barbearia grava (a coluna NÃO recebe grant de update);
--   3) get_public_shop (mesma função da 0010) passa a devolver 'template'.
-- Como desfazer: reaplicar get_public_shop da 0010; drop function public.save_site_template(uuid, text);
--                alter table public.barbershops drop column template;
--------------------------------------------------------------

alter table public.barbershops
  add column template text not null default 'urbano'
  constraint barbershops_template_check check (template in ('urbano', 'classico', 'minimalista', 'moderno', 'premium'));

create function public.save_site_template(p_barbershop_id uuid, p_template text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_template is null or p_template not in ('urbano', 'classico', 'minimalista', 'moderno', 'premium') then
    raise exception 'invalid_template' using errcode = 'P0001';
  end if;
  update public.barbershops set template = p_template where id = p_barbershop_id;
end;
$$;

revoke all on function public.save_site_template(uuid, text) from public, anon;
grant execute on function public.save_site_template(uuid, text) to authenticated;

--------------------------------------------------------------
-- Página pública: mesma função da 0010, mais o modelo escolhido
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
