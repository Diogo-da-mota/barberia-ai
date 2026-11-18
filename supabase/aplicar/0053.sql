-- Cópia de supabase/migrations/0053_slug_limite.sql para o banco remoto. No máximo 5 endereços por barbearia (o 6º novo recebe slug_limit).
--   supabase db query --remote --yes -f supabase/aplicar/0053.sql
-- Conferir depois, só leitura: select prosrc like '%slug_limit%' from pg_proc where proname = 'claim_shop_slug'; (esperado: true)
begin;
-- Barberia AI — migração 0053: limite de endereços (slugs) por barbearia (achado C3 da auditoria run-3).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0040. Testada em supabase/tests/slugs-reservados.test.ts.
-- Nenhum dado muda: só a função do gatilho barbershops_slug_claim.
--
-- Antes: cada troca de endereço registrava o novo para sempre (0040), sem teto; uma barbearia podia prender quantos
-- endereços quisesse e tirá-los de todas as outras. Agora cada barbearia guarda no máximo 5 endereços: o 6º novo é recusado
-- com 'slug_limit'; voltar a um endereço já usado continua livre e endereço de outra barbearia segue 'slug_taken'.
-- Trocas simultâneas da mesma barbearia esperam a trava da linha em barbershops, então a contagem não é furada.

create or replace function private.claim_shop_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.barbershop_slugs where slug = new.slug)
     and (select count(*) from public.barbershop_slugs where barbershop_id = new.id) >= 5 then
    raise exception 'slug_limit' using errcode = 'P0001';
  end if;
  insert into public.barbershop_slugs as s (slug, barbershop_id) values (new.slug, new.id)
  on conflict (slug) do update set registrado_em = s.registrado_em where s.barbershop_id = excluded.barbershop_id;
  if not found then
    raise exception 'slug_taken' using errcode = '23505';
  end if;
  return null;
end;
$$;

revoke all on function private.claim_shop_slug() from public, anon, authenticated;
commit;
