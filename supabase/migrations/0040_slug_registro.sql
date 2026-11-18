-- Barberia AI — migração 0040: endereço (slug) já usado por uma barbearia nunca passa para outra.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0001 e 0007. Testada em supabase/tests/slugs-reservados.test.ts.
-- Nenhum dado muda nas barbearias: só cria o registro de endereços e o gatilho que o confere.
--
-- Antes: set_shop_slug trocava o endereço e o antigo ficava livre na hora; qualquer conta podia registrá-lo (create_barbershop
-- ou set_shop_slug) e passava a receber os links já enviados em nome da primeira barbearia (link de reagendamento do WhatsApp,
-- atalho da última barbearia no navegador do cliente, links divulgados). Agora todo endereço que uma barbearia já usou fica
-- registrado para ela (chave primária no slug, gravada desde o primeiro uso, sem janela entre conferir e gravar): outra
-- barbearia recebe 'slug_taken' e a barbearia de origem pode voltar a ele. Carga inicial: os endereços atuais e o endereço com
-- que cada barbearia foi criada (audit_logs 'barbershop.created'), sem tirar de ninguém o endereço que usa hoje.

create table public.barbershop_slugs (
  slug text primary key,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  registrado_em timestamptz not null default now()
);
alter table public.barbershop_slugs enable row level security;
revoke all on table public.barbershop_slugs from public, anon, authenticated;

insert into public.barbershop_slugs (slug, barbershop_id) select slug, id from public.barbershops;
insert into public.barbershop_slugs (slug, barbershop_id, registrado_em)
select distinct on (a.detalhes ->> 'slug') a.detalhes ->> 'slug', a.barbershop_id, a.criado_em
from public.audit_logs a
join public.barbershops b on b.id = a.barbershop_id
where a.acao = 'barbershop.created' and coalesce(a.detalhes ->> 'slug', '') <> ''
order by a.detalhes ->> 'slug', a.criado_em
on conflict (slug) do nothing;

create function private.claim_shop_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.barbershop_slugs as s (slug, barbershop_id) values (new.slug, new.id)
  on conflict (slug) do update set registrado_em = s.registrado_em where s.barbershop_id = excluded.barbershop_id;
  if not found then
    raise exception 'slug_taken' using errcode = '23505';
  end if;
  return null;
end;
$$;

revoke all on function private.claim_shop_slug() from public, anon, authenticated;

create trigger barbershops_slug_claim
  after insert or update of slug on public.barbershops
  for each row execute function private.claim_shop_slug();
