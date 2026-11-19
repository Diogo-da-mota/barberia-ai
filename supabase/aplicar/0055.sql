-- Cópia de supabase/migrations/0055_alerta_ponte.sql para o banco remoto. O alerta passa pela Edge Function alerta-telegram (o banco não alcança o Telegram).
--   1) supabase functions deploy alerta-telegram --use-api   2) supabase db query --remote --yes -f supabase/aplicar/0055.sql
-- Conferir depois, só leitura: select enviado, erro from private.alertas_seguranca order by id desc limit 3;
begin;
-- Barberia AI — migração 0055: ponte do alerta de segurança para o Telegram (Edge Function alerta-telegram).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA, DEPOIS da 0054 e de publicar a função alerta-telegram.
-- Testada em supabase/tests/alerta-seguranca.test.ts. Nenhum dado muda.
--
-- Por quê: em produção o banco não alcança api.telegram.org (a conexão é cortada no caminho; o Google responde), então o
-- pg_net não entrega a mensagem. As Edge Functions alcançam a internet (WhatsApp, IA e S3 já saem por elas).
-- Como fica:
--   private.verificar_alertas() continua detectando os mesmos sinais, mas só GUARDA o alerta (enviado = false) e chama a
--     ponte pelo pg_net, com o endereço da função e a chave anon do Vault (os mesmos da limpeza de mídia). O pedido não leva
--     token nem texto: a ponte só envia o que está pendente no banco, então chamar a ponte de fora não manda nada novo.
--   A ponte (service_role) lê os pendentes das últimas 48 h e o token/chat (alerta_telegram_pendentes), envia ao Telegram e
--     marca cada um (alerta_telegram_resultado). O que falhar fica pendente com o motivo e sai na próxima chamada.
--   Histórico: select * from private.alertas_seguranca order by id desc;

create or replace function private.verificar_alertas(p_resumo boolean default false)
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
  v_id bigint;
  v_url text;
  v_anon text;
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

  insert into private.alertas_seguranca (tipo, mensagem)
  values (case when p_resumo then 'resumo' else 'alerta' end, v_msg)
  returning id into v_id;

  if to_regclass('vault.decrypted_secrets') is not null then
    select regexp_replace(s.decrypted_secret, '/functions/v1/.*$', '/functions/v1/alerta-telegram') into v_url
    from vault.decrypted_secrets s where s.name = 'barberia_media_migrate_url';
    select s.decrypted_secret into v_anon from vault.decrypted_secrets s where s.name = 'barberia_anon_key';
  end if;
  if coalesce(v_url, '') !~ '/functions/v1/alerta-telegram$' or coalesce(v_anon, '') = '' or to_regnamespace('net') is null then
    update private.alertas_seguranca set erro = 'url_ausente_no_vault' where id = v_id;
    return v_msg;
  end if;
  select net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'apikey', v_anon),
    timeout_milliseconds := 30000
  ) into v_request;
  update private.alertas_seguranca set request_id = v_request where id = v_id;
  return v_msg;
end;
$$;

revoke all on function private.verificar_alertas(boolean) from public, anon, authenticated;

-- Pendentes (até 10, das últimas 48 h) e o token/chat do Telegram: só a ponte (service_role)
create function public.alerta_telegram_pendentes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_chat text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'barberia_telegram_token';
    select s.decrypted_secret into v_chat from vault.decrypted_secrets s where s.name = 'barberia_telegram_chat_id';
  end if;
  return jsonb_build_object(
    'token', v_token,
    'chat_id', v_chat,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'mensagem', a.mensagem) order by a.id)
      from (select x.id, x.mensagem from private.alertas_seguranca x
            where not x.enviado and x.criado_em > now() - interval '48 hours' order by x.id limit 10) a
    ), '[]'::jsonb)
  );
end;
$$;

create function public.alerta_telegram_resultado(p_id bigint, p_ok boolean, p_erro text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.alertas_seguranca
  set enviado = p_ok, erro = case when p_ok then null else left(coalesce(p_erro, 'falha'), 200) end
  where id = p_id;
$$;

revoke all on function public.alerta_telegram_pendentes(), public.alerta_telegram_resultado(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.alerta_telegram_pendentes(), public.alerta_telegram_resultado(bigint, boolean, text) to service_role;
commit;
