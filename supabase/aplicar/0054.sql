-- Cópia de supabase/migrations/0054_alerta_seguranca.sql para o banco remoto. Alerta de segurança no Telegram (toda hora) e resumo diário às 09:00 de Brasília.
--   supabase db query --remote --yes -f supabase/aplicar/0054.sql   (depois: sh supabase/aplicar/segredos-alerta-telegram.sh)
-- Conferir depois, só leitura: select jobname, schedule from cron.job where jobname like 'barberia-alerta%'; (esperado: 2 linhas)
begin;
-- Barberia AI — migração 0054: alerta de segurança no Telegram (sinais que o próprio banco enxerga).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA, DEPOIS da 0051. Os segredos do Telegram vão para o Vault pelo script
-- supabase/aplicar/segredos-alerta-telegram.sh. Testada em supabase/tests/alerta-seguranca.test.ts. Nenhum dado muda.
--
-- Como funciona:
--   barberia-alerta-seguranca (5 * * * *, toda hora): private.verificar_alertas() olha a ÚLTIMA HORA e só manda mensagem
--     se houver algo estranho: 20+ contas novas (cadastro em massa), rotina automática (pg_cron) com erro, limpeza de mídia
--     com erro, 5+ mensagens de WhatsApp que falharam.
--   barberia-alerta-resumo (0 12 * * *, 09:00 de Brasília): private.verificar_alertas(true) olha as últimas 24 h (limites
--     100 contas e 20 falhas) e SEMPRE manda uma mensagem: "nenhum alerta" mostra que o alerta está vivo.
--   O token e o chat do Telegram ficam no Vault (barberia_telegram_token, barberia_telegram_chat_id). Sem eles, nada é
--     chamado e o motivo fica no histórico. O token nunca é gravado no histórico.
--   Histórico: select * from private.alertas_seguranca order by id desc;  Execuções: cron.job_run_details.
--   Desligar: select cron.unschedule('barberia-alerta-seguranca'); select cron.unschedule('barberia-alerta-resumo');
-- Login errado em massa não aparece aqui (fica só nos registros do Supabase Auth, que já bloqueia por IP).

create table private.alertas_seguranca (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  tipo text not null check (tipo in ('alerta', 'resumo')),
  mensagem text not null,
  enviado boolean not null default false,
  request_id bigint,
  erro text
);
revoke all on table private.alertas_seguranca from public, anon, authenticated;
revoke all on sequence private.alertas_seguranca_id_seq from public, anon, authenticated;

create function private.verificar_alertas(p_resumo boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_desde timestamptz := now() - case when p_resumo then interval '24 hours' else interval '1 hour' end;
  v_periodo text := case when p_resumo then 'nas últimas 24 h' else 'na última hora' end;
  v_linhas text[] := '{}';
  v_n bigint;
  v_txt text;
  v_msg text;
  v_token text;
  v_chat text;
  v_request bigint;
begin
  select count(*) into v_n from auth.users u where u.created_at >= v_desde;
  if v_n >= (case when p_resumo then 100 else 20 end) then
    v_linhas := v_linhas || format('Cadastro em massa: %s contas novas %s.', v_n, v_periodo);
  end if;

  if to_regclass('cron.job_run_details') is not null then
    execute 'select string_agg(distinct j.jobname, '', '') from cron.job_run_details d join cron.job j on j.jobid = d.jobid
             where d.status = ''failed'' and d.start_time >= $1' into v_txt using v_desde;
    if v_txt is not null then
      v_linhas := v_linhas || format('Rotina automática com erro: %s.', v_txt);
    end if;
  end if;

  select string_agg(distinct r.erro, ', ') into v_txt from private.media_cleanup_runs r
  where r.erro is not null and coalesce(r.concluido_em, r.iniciado_em) >= v_desde;
  if v_txt is not null then
    v_linhas := v_linhas || format('Limpeza de mídia com erro: %s.', v_txt);
  end if;

  select count(*) into v_n from public.outbox_events o where o.status = 'falhou' and o.atualizado_em >= v_desde;
  if v_n >= (case when p_resumo then 20 else 5 end) then
    v_linhas := v_linhas || format('%s mensagens de WhatsApp falharam %s.', v_n, v_periodo);
  end if;

  if cardinality(v_linhas) = 0 and not p_resumo then
    return null;
  end if;
  v_msg := case
    when cardinality(v_linhas) = 0 then 'Barberia: nenhum alerta nas últimas 24 h. O alerta de segurança está funcionando.'
    else case when p_resumo then 'Barberia: resumo das últimas 24 h' else 'Barberia: alerta de segurança' end
      || chr(10) || '- ' || array_to_string(v_linhas, chr(10) || '- ')
      || chr(10) || 'Histórico: select * from private.alertas_seguranca order by id desc;'
  end;

  if to_regclass('vault.decrypted_secrets') is not null then
    select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'barberia_telegram_token';
    select s.decrypted_secret into v_chat from vault.decrypted_secrets s where s.name = 'barberia_telegram_chat_id';
  end if;
  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' or to_regnamespace('net') is null then
    insert into private.alertas_seguranca (tipo, mensagem, erro)
    values (case when p_resumo then 'resumo' else 'alerta' end, v_msg, 'segredo_ausente_no_vault');
    return v_msg;
  end if;
  select net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body := jsonb_build_object('chat_id', v_chat, 'text', v_msg),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  ) into v_request;
  insert into private.alertas_seguranca (tipo, mensagem, enviado, request_id)
  values (case when p_resumo then 'resumo' else 'alerta' end, v_msg, true, v_request);
  return v_msg;
end;
$$;

revoke all on function private.verificar_alertas(boolean) from public, anon, authenticated;

-- Agendamento (cron.schedule com o mesmo nome atualiza o job existente: reaplicar não duplica)
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('barberia-alerta-seguranca', '5 * * * *', 'select private.verificar_alertas()');
    perform cron.schedule('barberia-alerta-resumo', '0 12 * * *', 'select private.verificar_alertas(true)');
  end if;
end;
$$;
commit;
