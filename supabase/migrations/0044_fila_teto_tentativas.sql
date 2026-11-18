-- Barberia AI — migração 0044: linha presa na fila do WhatsApp tem teto de tentativas e recuo, e não passa na frente das outras.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0006 e 0018 (mesma assinatura; create or replace mantém permissões).
-- Aplicar DEPOIS de supabase/aplicar/diferenca-reagendamento.sql, que recria private.manter_fila sem esta correção.
-- Testada em supabase/tests/fila-teto.test.ts. Nenhum dado muda.
--
-- Antes: o primeiro passo de private.manter_fila devolvia para 'pendente' toda linha 'enviando' há mais de 10 minutos, sem
-- comparar tentativas com max_tentativas e sem mudar proximo_envio. claim_whatsapp_outbox e claim_outbox reivindicam pela
-- proximo_envio original, para todas as barbearias: uma linha cujo resultado o worker não consegue registrar girava para
-- sempre e sempre na frente; cerca de 200 delas paravam as confirmações e lembretes das outras barbearias. Agora vale o mesmo
-- teto e o mesmo recuo de complete_outbox. O worker (supabase/functions/_shared/whatsapp-outbox.ts) também deixa de cortar o
-- erro no meio de um caractere, o que fazia o complete_outbox ser recusado.

create or replace function private.manter_fila()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A Evolution não oferece chave idempotente no envio de texto. Se a confirmação pode ter saído,
  -- finaliza a tentativa como incerta para impedir que uma nova execução duplique a mensagem.
  -- Linha 'enviando' cujo resultado o worker não registrou volta com o MESMO teto e o MESMO recuo de complete_outbox:
  -- passou de max_tentativas → 'falhou'; senão volta para 'pendente' com proximo_envio adiado (antes voltava sem teto e
  -- sempre na frente da fila global, e um registro que nunca concluía ocupava a vez das outras barbearias).
  update public.outbox_events
  set status = case when (tipo = 'reserva_reagendada' and max_tentativas = 1) or tentativas >= max_tentativas then 'falhou' else 'pendente' end,
      ultimo_erro = case when tipo = 'reserva_reagendada' and max_tentativas = 1 then 'envio_incerto'
                         when tentativas >= max_tentativas then 'sem_resultado_do_envio'
                         else ultimo_erro end,
      proximo_envio = now() + make_interval(mins => least(power(2, least(tentativas, 7))::integer, 120)),
      atualizado_em = now()
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
