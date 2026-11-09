-- Cópia de supabase/migrations/0018_fila_whatsapp.sql para o banco remoto. PENDENTE: rodar uma única vez, só com autorização,
-- DEPOIS de supabase/aplicar/diferenca-lembretes.sql (sem ela, a transação para no primeiro bloco e nada muda):
--   ! supabase db query --remote --yes -f supabase/aplicar/0018.sql
-- Pode ser reaplicado sem efeito (só create or replace).
-- Conferir depois, só leitura (esperado: true | true):
--   ! supabase db query --remote --read-only "select to_regprocedure('public.claim_whatsapp_outbox(integer)') is not null as claim_whatsapp, position('manter_fila' in pg_get_functiondef('public.claim_outbox(integer)'::regprocedure)) > 0 as claim_geral"
begin;

-- Barberia AI — migração 0018: entrega de confirmações e lembretes pela instância Evolution de cada barbearia
-- Um assunto só: o worker (disparado pelo n8n a cada minuto) reivindica apenas confirmações e lembretes do WhatsApp,
-- já com a instância Evolution da barbearia. Os demais avisos continuam na fila, intactos, para o claim_outbox geral.
-- Depende da 0016 (integration_accounts.evolution_instance_name) e da 0017 (janela do lembrete e configuração).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA.

do $$
begin
  if to_regprocedure('private.lembrete_vencido(jsonb)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'integration_accounts' and column_name = 'evolution_instance_name') then
    raise exception '0018 depende da 0016 (evolution_instance_name) e da 0017 (private.lembrete_vencido)';
  end if;
end;
$$;

--------------------------------------------------------------
-- Manutenção da fila antes de qualquer entrega (o mesmo que o claim_outbox da 0017 fazia), compartilhada pelos dois claims:
-- envio preso volta, lembrete com a janela fechada sai, configuração desligada cancela, PARAR e limite por número valem,
-- e sem canal ativo nada é entregue.
--------------------------------------------------------------
create or replace function private.manter_fila()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.outbox_events set status = 'pendente', atualizado_em = now()
  where status = 'enviando' and atualizado_em < now() - interval '10 minutes';

  update public.outbox_events e
  set status = 'cancelado',
      ultimo_erro = 'reserva_vencida',
      atualizado_em = now()
  where e.tipo like 'lembrete%' and e.status in ('pendente', 'bloqueado')
    and private.lembrete_vencido(e.payload);

  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'reserva_reagendada', atualizado_em = now()
  from public.bookings b
  where b.id = e.booking_id
    and e.tipo like 'lembrete%' and e.status in ('pendente', 'bloqueado')
    and (e.payload ->> 'inicio')::timestamptz <> b.inicio;

  update public.outbox_events e
  set status = 'cancelado',
      ultimo_erro = case when e.tipo = 'reserva_confirmada' then 'confirmacao_desativada' else 'lembrete_desativado' end,
      atualizado_em = now()
  from public.barbershops s
  where s.id = e.barbershop_id and e.status in ('pendente', 'bloqueado')
    and (
      (e.tipo = 'reserva_confirmada' and s.reminder_config -> 'auto_confirmation' = 'false'::jsonb)
      or (e.tipo like 'lembrete%' and s.reminder_config -> 'auto_reminder' = 'false'::jsonb)
    );

  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'opt_out', atualizado_em = now()
  where e.status in ('pendente', 'bloqueado') and e.tipo like 'reativacao%'
    and not exists (
      select 1 from public.customer_consents c
      where c.barbershop_id = e.barbershop_id and c.profile_id = e.customer_id and c.marketing
    );

  -- número que pediu PARAR a esta barbearia não recebe nada dela (nem avisos da reserva): o titular do número pode não ser quem reservou
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'numero_bloqueado', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status in ('pendente', 'bloqueado')
    and exists (
      select 1 from public.phone_blocklist b
      where b.barbershop_id = e.barbershop_id and b.telefone = private.br_phone_key(e.destino)
    );

  -- no máximo 12 mensagens por número em 24h, por barbearia (3 reservas × 3 avisos): nenhuma vira canal de spam para terceiros nem afeta as outras
  update public.outbox_events e
  set status = 'cancelado', ultimo_erro = 'limite_destino', atualizado_em = now()
  where e.canal = 'whatsapp' and e.status = 'pendente'
    and (
      select count(*) from public.outbox_events x
      where x.canal = 'whatsapp' and x.barbershop_id = e.barbershop_id
        and x.status in ('enviado', 'enviando') and x.atualizado_em > now() - interval '24 hours'
        and private.br_phone_key(x.destino) = private.br_phone_key(e.destino)
    ) >= 12;

  update public.outbox_events e
  set status = 'bloqueado', ultimo_erro = 'canal_nao_configurado', atualizado_em = now()
  where e.status = 'pendente' and e.proximo_envio <= now()
    and not exists (
      select 1 from public.integration_accounts i
      where i.barbershop_id = e.barbershop_id and i.provider = e.canal and i.status = 'ativo'
    );
end;
$$;

revoke all on function private.manter_fila() from public, anon, authenticated;

--------------------------------------------------------------
-- claim_outbox: mesma entrega de antes (todos os tipos), agora com a manutenção compartilhada
--------------------------------------------------------------
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
  perform private.manter_fila();

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

--------------------------------------------------------------
-- claim_whatsapp_outbox: só reserva_confirmada e lembretes do WhatsApp, com a instância Evolution da barbearia
--   instancia nula = barbearia sem instância Evolution: o worker registra a falha na própria linha.
--------------------------------------------------------------
create or replace function public.claim_whatsapp_outbox(p_limit integer default 20)
returns table (id uuid, barbershop_id uuid, booking_id uuid, tipo text, destino text, payload jsonb, tentativas integer, instancia text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 20;
  end if;
  perform private.manter_fila();

  return query
  with alvo as (
    select e.id
    from public.outbox_events e
    where e.status = 'pendente' and e.proximo_envio <= now() and e.canal = 'whatsapp'
      and (e.tipo = 'reserva_confirmada' or e.tipo like 'lembrete\_%')
    order by e.proximo_envio
    limit p_limit
    for update skip locked
  ), marcado as (
    update public.outbox_events o
    set status = 'enviando', tentativas = o.tentativas + 1, atualizado_em = now()
    from alvo
    where o.id = alvo.id
    returning o.id, o.barbershop_id, o.booking_id, o.tipo, o.destino, o.payload, o.tentativas
  )
  select m.id, m.barbershop_id, m.booking_id, m.tipo, m.destino, m.payload, m.tentativas, i.evolution_instance_name
  from marcado m
  left join public.integration_accounts i on i.barbershop_id = m.barbershop_id and i.provider = 'whatsapp';
end;
$$;

revoke all on function public.claim_whatsapp_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_outbox(integer) to service_role;

commit;
