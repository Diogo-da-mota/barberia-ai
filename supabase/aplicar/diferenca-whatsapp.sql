-- DIFERENÇA a aplicar no banco remoto (tarefa A1 de DIAGNOSTICO_WHATSAPP_N8N.md).
-- O que muda: cria public.phone_blocklist (0006) e devolve a public.claim_outbox os dois blocos que faltam (0009):
--   bloqueio de número que pediu PARAR e limite de 12 mensagens por número em 24h.
-- O que NÃO muda: nenhuma linha existente, nenhuma outra tabela ou função. As migrations locais já têm este conteúdo.
-- Efeito imediato: process_whatsapp_reply volta a encontrar a tabela. O claim_outbox só roda com o outbox-worker, que não está implantado.
-- Pode ser reaplicado sem efeito. Testado em supabase/tests/diferenca-whatsapp.test.ts.
--
-- Rodar uma vez, com autorização:
--   ! supabase db query --remote --yes -f supabase/aplicar/diferenca-whatsapp.sql
--
-- Conferir depois, só leitura (esperado: true | false | false | true):
--   ! supabase db query --remote --read-only "select to_regclass('public.phone_blocklist') is not null as tabela, has_table_privilege('anon','public.phone_blocklist','select') as anon, has_table_privilege('authenticated','public.phone_blocklist','select') as autenticado, pg_get_functiondef('public.claim_outbox(integer)'::regprocedure) like '%limite_destino%' as limite"
--
-- Como desfazer: reaplicar supabase/tests/fixtures/remoto-claim_outbox.sql e executar drop table public.phone_blocklist.
-- Atenção: apagar a tabela perde os pedidos de PARAR já gravados, e o PARAR volta a dar erro.
begin;

-- Números que pediram PARAR (qualquer aviso). O WhatsApp informado na reserva não é verificado, então o titular
-- do número precisa de um jeito de parar tudo. Sem nenhum acesso pela API: só as funções de servidor leem e gravam.
create table if not exists public.phone_blocklist (
  telefone text primary key check (telefone ~ '^[0-9]{10}$'),
  criado_em timestamptz not null default now()
);
revoke all on table public.phone_blocklist from public, anon, authenticated;
alter table public.phone_blocklist enable row level security;

-- claim_outbox da 0009, exigindo a integração do CANAL do evento (whatsapp ou google_calendar)
create or replace function public.claim_outbox(p_limit integer default 20)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 20;
  end if;
  update public.outbox_events set status = 'pendente', atualizado_em = now()
  where status = 'enviando' and atualizado_em < now() - interval '10 minutes';

  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'opt_out', atualizado_em = now()
  where e.status in ('pendente', 'bloqueado') and e.tipo like 'reativacao%'
    and not exists (
      select 1 from public.customer_consents c
      where c.barbershop_id = e.barbershop_id and c.profile_id = e.customer_id and c.marketing
    );

  -- número que pediu PARAR não recebe nada (nem avisos da reserva): o titular do número pode não ser quem reservou
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'numero_bloqueado', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status in ('pendente', 'bloqueado')
    and exists (select 1 from public.phone_blocklist b where b.telefone = right(regexp_replace(e.destino, '\D', '', 'g'), 10));

  -- no máximo 12 mensagens por número em 24h (3 reservas × 3 avisos): a barbearia não pode virar canal de spam para terceiros
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'limite_destino', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status = 'pendente'
    and (
      select count(*) from public.outbox_events x
      where x.canal = 'whatsapp' and x.status in ('enviado', 'enviando') and x.atualizado_em > now() - interval '24 hours'
        and right(regexp_replace(x.destino, '\D', '', 'g'), 10) = right(regexp_replace(e.destino, '\D', '', 'g'), 10)
    ) >= 12;

  update public.outbox_events e
  set status = 'bloqueado', ultimo_erro = 'canal_nao_configurado', atualizado_em = now()
  where e.status = 'pendente' and e.proximo_envio <= now()
    and not exists (
      select 1 from public.integration_accounts i
      where i.barbershop_id = e.barbershop_id and i.provider = e.canal and i.status = 'ativo'
    );

  return query
  update public.outbox_events set status = 'enviando', tentativas = tentativas + 1, atualizado_em = now()
  where id in (
    select id from public.outbox_events
    where status = 'pendente' and proximo_envio <= now()
    order by proximo_envio
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

revoke all on function public.claim_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_outbox(integer) to service_role;

commit;
