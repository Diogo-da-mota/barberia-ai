-- Despesas fixas recorrentes para analisar o fluxo em /financeiro/despesas (barbearia "babearia-do-tico").
-- NÃO é migration: só cria dados, pelas MESMAS funções que a tela usa (create_expenses em lote, como o dono).
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/dados-despesas-recorrentes.sql
-- Uma transação: ou cria as 7 recorrências, ou nada. Os ids são fixos: rodar de novo não duplica.
-- O Aluguel (todo dia 10) já existe e não é tocado.
-- Para desfazer depois: em cada uma, "Encerrar" na seção Despesas recorrentes (as contas futuras saem) e excluir as pendentes que sobrarem.
begin;

-- age como o proprietário da barbearia (as funções conferem a permissão de quem chama)
select set_config('request.jwt.claims', json_build_object('sub', m.profile_id, 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', m.profile_id::text, true)
from public.memberships m
join public.barbershops b on b.id = m.barbershop_id
where b.slug = 'babearia-do-tico' and m.papel = 'proprietario'
limit 1;

select public.create_expenses(
  (select id from public.barbershops where slug = 'babearia-do-tico'),
  '[
    {"id": "d0000000-0000-4000-8000-000000000001", "descricao": "Sistema de agendamento", "categoria": "Assinaturas", "valor_centavos": 8990,  "vencimento": "2026-11-01", "forma": "credito",       "frequencia": "mensal"},
    {"id": "d0000000-0000-4000-8000-000000000002", "descricao": "Internet",               "categoria": "Internet",    "valor_centavos": 9990,  "vencimento": "2026-11-05", "forma": "pix",           "frequencia": "mensal"},
    {"id": "d0000000-0000-4000-8000-000000000003", "descricao": "Energia elétrica",       "categoria": "Energia",     "valor_centavos": 38000, "vencimento": "2026-11-15", "forma": "boleto",        "frequencia": "mensal"},
    {"id": "d0000000-0000-4000-8000-000000000004", "descricao": "Água",                   "categoria": "Água",        "valor_centavos": 12000, "vencimento": "2026-11-20", "forma": "boleto",        "frequencia": "mensal"},
    {"id": "d0000000-0000-4000-8000-000000000005", "descricao": "Contador",               "categoria": "Serviços",    "valor_centavos": 35000, "vencimento": "2026-11-28", "forma": "transferencia", "frequencia": "mensal"},
    {"id": "d0000000-0000-4000-8000-000000000006", "descricao": "Lavanderia de toalhas",  "categoria": "Serviços",    "valor_centavos": 4500,  "vencimento": "2026-11-17", "forma": "dinheiro",      "frequencia": "semanal"},
    {"id": "d0000000-0000-4000-8000-000000000007", "descricao": "Produtos de limpeza",    "categoria": "Produtos",    "valor_centavos": 6000,  "vencimento": "2026-11-18", "forma": null,            "frequencia": "quinzenal"}
  ]'::jsonb
) as recorrencias_enviadas;

commit;

-- resumo do que ficou (só leitura)
select to_char(e.data, 'YYYY-MM') as mes, count(*) as contas, sum(e.valor_centavos) / 100.0 as total_reais,
       count(*) filter (where e.situacao = 'pendente' and e.data < (now() at time zone 'America/Sao_Paulo')::date) as vencidas
from public.expenses e
join public.barbershops b on b.id = e.barbershop_id
where b.slug = 'babearia-do-tico'
group by 1 order by 1;
