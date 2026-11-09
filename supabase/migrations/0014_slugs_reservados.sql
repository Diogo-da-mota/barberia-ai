--------------------------------------------------------------
-- 0014: palavras reservadas como endereço (slug) de barbearia
-- Um assunto só. O endereço público passa a ficar na raiz (/:slug), então nenhuma barbearia pode ter um slug que seja
-- uma rota ou pasta do sistema (dashboard, login, auth, acesso, convite, minhas-reservas, e, site, api…).
-- Mudança aditiva e reversível:
--   1) private.is_reserved_slug(text): a lista de palavras (a MESMA de src/lib/shopPaths.ts; um teste confere);
--   2) CHECK barbershops_slug_not_reserved, criada NOT VALID: vale para todo slug novo ou alterado (create_barbershop e set_shop_slug
--      gravam como o dono da tabela, então nada precisa ser reescrito) e NÃO reprova linhas antigas.
--   Antes de aplicar, foi conferido no banco que nenhum slug existente é reservado; só então a constraint pode ser validada
--   (alter table … validate constraint), o que é opcional.
-- Como desfazer: alter table public.barbershops drop constraint barbershops_slug_not_reserved; drop function private.is_reserved_slug(text);
--------------------------------------------------------------

create function private.is_reserved_slug(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p, ''))) = any (array[
    'dashboard', 'login', 'auth', 'acesso', 'convite', 'minhas-reservas', 'e',
    'site', 'site-albuns', 'admin', 'app', 'painel', 'entrar', 'cadastro', 'cadastrar', 'planos', 'precos', 'suporte', 'ajuda', 'termos', 'privacidade', 'contato', 'sobre', 'blog',
    'api', 'assets', 'images', 'static', 'public', 'src', 'robots', 'sitemap', 'manifest', 'favicon', 'health', 'status', 'www'
  ])
$$;
revoke all on function private.is_reserved_slug(text) from public, anon;
grant execute on function private.is_reserved_slug(text) to authenticated;

alter table public.barbershops
  add constraint barbershops_slug_not_reserved check (not private.is_reserved_slug(slug)) not valid;
