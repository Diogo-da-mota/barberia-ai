-- Cópia de supabase/migrations/0034_origem_conta_equipe.sql para o banco remoto (depois da 0033). Só cria uma função de leitura.
-- supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0034.sql
-- Conferir depois, só leitura: select proname from pg_proc where proname = 'get_team_account_origins';
begin;
-- Barberia AI — migração 0034: origem do cadastro de cada profissional na Equipe (ícone ao lado do nome).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0001, 0004 e 0033. Só leitura: nenhum dado muda.
--
-- O navegador não lê auth.users/auth.identities. Esta função devolve, só para a gestão da barbearia, a origem de cada
-- profissional: 'manual' (card sem conta vinculada), 'google' ou 'email', pelo método REAL do Supabase Auth da conta
-- vinculada (nunca pelo domínio do e-mail). Com mais de um método, vale o original: a identidade mais antiga; sem
-- identidades registradas, o provedor de criação (app_metadata.provider). Quando um cadastro manual aceita o convite
-- (0033 liga profile_id), a origem muda sozinha na próxima leitura. Não devolve e-mail nem telefone.

create function public.get_team_account_origins(p_barbershop_id uuid)
returns table (professional_id uuid, origem text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select p.id,
         case
           when p.profile_id is null then 'manual'
           when coalesce(
             (select i.provider from auth.identities i where i.user_id = p.profile_id order by i.created_at nulls last, i.provider limit 1),
             u.raw_app_meta_data->>'provider'
           ) = 'google' then 'google'
           else 'email'
         end
  from public.professionals p
  left join auth.users u on u.id = p.profile_id
  where p.barbershop_id = p_barbershop_id;
end;
$$;

revoke all on function public.get_team_account_origins(uuid) from public, anon;
grant execute on function public.get_team_account_origins(uuid) to authenticated;
commit;
