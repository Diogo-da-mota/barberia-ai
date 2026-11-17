-- Cópia de supabase/migrations/0032_slugs_painel.sql para o banco remoto (depois da 0031). Aplicar uma vez só, de preferência antes de publicar as rotas novas.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0032.sql
-- Conferir depois, só leitura (esperado: true):
--   supabase db query --remote=hbkbdqctelembzqiptpi --read-only "select private.is_reserved_slug('financeiro') as nova"
begin;

-- 0032: telas do painel na raiz viram palavras reservadas (complemento da 0014).
-- As rotas do painel saíram de /dashboard/<tela> para /<tela> (/agendamentos, /financeiro/despesas…), no mesmo
-- nível do endereço das barbearias (/:slug). Nenhuma barbearia pode ocupar esses nomes.
-- Só troca a lista de private.is_reserved_slug (a MESMA de src/lib/shopPaths.ts; um teste confere). A constraint
-- barbershops_slug_not_reserved (NOT VALID, 0014) já usa a função: vale para slug novo ou alterado e não reprova
-- linhas antigas. Conferido antes: nenhuma barbearia existente usa as palavras novas.

create or replace function private.is_reserved_slug(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p, ''))) = any (array[
    'dashboard', 'login', 'auth', 'acesso', 'convite', 'minhas-reservas', 'e',
    'agendamentos', 'clientes', 'financeiro', 'analises', 'mensagens', 'configuracoes', 'servicos', 'equipe', 'mais', 'barbearias', 'horarios',
    'site', 'site-albuns', 'admin', 'app', 'painel', 'entrar', 'cadastro', 'cadastrar', 'planos', 'precos', 'suporte', 'ajuda', 'termos', 'privacidade', 'contato', 'sobre', 'blog',
    'api', 'assets', 'images', 'static', 'public', 'src', 'robots', 'sitemap', 'manifest', 'favicon', 'health', 'status', 'www'
  ])
$$;

commit;
