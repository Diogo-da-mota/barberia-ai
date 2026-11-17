-- Ativa os profissionais que ficaram inativos SÓ por causa do limite antigo (2) do plano Inicial.
-- NÃO é migration: só dados (nenhuma função ou tabela muda).
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/dados-ativar-equipe-limite.sql
--
-- Por que continuavam inativos: ao aceitar o convite, ensure_team_professional (0033) cria o card INATIVO quando o
-- plano está no limite. NEX FLOW e Shop Alibrasil nasceram assim em 2026-11-17 13:39 UTC (barbearia em 2/2) e,
-- enquanto o limite era 2, ativar era recusado (plan_limit). Subir o limite para 5 não muda cards já gravados.
-- Nunca estiveram ativos, então não há desativação intencional a preservar. Só estes dois ids entram, e só se ainda
-- estiverem inativos e tiverem nascido do convite (registro professional.linked no mesmo instante da criação).
-- Nenhum registro novo de profissional: só muda ativo. Rodar de novo não muda nada.
-- O gatilho do limite (0008) continua valendo: sem vaga, o card fica inativo e nada passa de 5.
begin;

do $$
declare
  r record;
begin
  for r in
    select x.id, x.barbershop_id
    from public.professionals x
    where x.id in ('c52bed38-8d9f-4eb6-af75-54267a61e87c', '00bd1a49-3041-401b-ab85-84a094d00458') -- NEX FLOW, Shop Alibrasil
      and not x.ativo
      and x.profile_id is not null
      and exists (
        select 1 from public.audit_logs a
        where a.acao = 'professional.linked' and a.detalhes->>'origem' = 'convite'
          and a.detalhes->>'professional_id' = x.id::text and a.criado_em = x.criado_em
      )
    order by x.criado_em, x.nome
  loop
    begin
      update public.professionals set ativo = true where id = r.id;
      insert into public.audit_logs (barbershop_id, acao, detalhes)
      values (r.barbershop_id, 'professional.activated', jsonb_build_object('professional_id', r.id, 'origem', 'limite_antigo'));
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'plan_limit' then
        raise;
      end if;
      raise notice 'sem vaga no plano para %', r.id;
    end;
  end loop;
end;
$$;

commit;

-- Conferir depois (só leitura; esperado: 4 ativos de 5):
-- select nome, ativo from public.professionals order by nome;
-- select max_profissionais from public.plans where id = 'inicial';
