-- Cópia de supabase/migrations/0051_midia_limpeza_agendada.sql para o banco remoto. Instala pg_cron e pg_net e agenda a limpeza diária (06:00 UTC = 03:00 Brasília). Antes: 0050 e supabase/aplicar/segredos-limpeza-midia.sh.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0051.sql
-- Conferir depois, só leitura: select jobname, schedule, active from cron.job where jobname like 'barberia-limpeza-midia%'; (esperado: 2 linhas, active = true)
begin;
-- Barberia AI — migração 0051: limpeza diária dos envios órfãos do S3 às 03:00 de Brasília (06:00 UTC) com Supabase Cron.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA, DEPOIS da 0050 e dos segredos no Vault (supabase/aplicar/segredos-limpeza-midia.sh).
-- Testada em supabase/tests/limpeza-midia.test.ts (cron, pg_net e Vault simulados). Nenhum dado muda.
--
-- Como funciona:
--   barberia-limpeza-midia (0 6 * * *): private.start_media_cleanup() lê do Vault o endereço da função, a chave anon (exigida
--     pelo gateway, verify_jwt) e o segredo da media-migrate (cabeçalho x-migrate-secret, o mesmo controle de sempre) e faz
--     POST {"acao":"limpar-orfaos"} pelo pg_net. Sem os segredos, não chama nada e registra 'segredo_ausente_no_vault'.
--   barberia-limpeza-midia-resultado (20 6 * * *): private.collect_media_cleanup() copia o resultado da resposta (status,
--     encontrados, apagados, falhas, erro curto) para private.media_cleanup_runs. Nenhum segredo é gravado: o histórico só tem
--     números e a mensagem de erro cortada em 200 caracteres.
--   Histórico: select * from private.media_cleanup_runs order by id desc;  Execuções do cron: cron.job_run_details.
--   Desligar: select cron.unschedule('barberia-limpeza-midia');  (o de resultado pode ficar; sem execução ele não faz nada)
-- O fuso do pg_cron no Supabase é GMT (cron.timezone); 06:00 UTC = 03:00 em Brasília (sem horário de verão desde 2019).
-- Em banco sem pg_cron/pg_net (testes locais), as extensões e o agendamento são pulados; as funções e a tabela são criadas.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end;
$$;

create table private.media_cleanup_runs (
  id bigserial primary key,
  iniciado_em timestamptz not null default now(),
  request_id bigint,
  status_http integer,
  encontrados integer,
  apagados integer,
  falhas integer,
  erro text check (erro is null or length(erro) <= 200),
  concluido_em timestamptz
);
revoke all on table private.media_cleanup_runs from public, anon, authenticated;
revoke all on sequence private.media_cleanup_runs_id_seq from public, anon, authenticated;

create function private.collect_media_cleanup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
  v_resp record;
  v_json jsonb;
  v_feitas integer := 0;
begin
  if to_regclass('net._http_response') is null then
    return 0;
  end if;
  for v_run in
    select r.id, r.request_id, r.iniciado_em from private.media_cleanup_runs r
    where r.concluido_em is null and r.request_id is not null
    order by r.id
  loop
    select h.status_code, h.content, h.timed_out, h.error_msg into v_resp
    from net._http_response h where h.id = v_run.request_id;
    if not found then
      -- O pg_net guarda as respostas por 6 h: sem resposta depois de 5 h, encerra como erro
      if v_run.iniciado_em < now() - interval '5 hours' then
        update private.media_cleanup_runs set erro = 'sem_resposta', concluido_em = now() where id = v_run.id;
        v_feitas := v_feitas + 1;
      end if;
      continue;
    end if;
    begin
      v_json := v_resp.content::jsonb;
    exception when others then
      v_json := null;
    end;
    update private.media_cleanup_runs set
      status_http = v_resp.status_code,
      encontrados = case when v_resp.status_code = 200 then (v_json ->> 'encontrados')::integer end,
      apagados = case when v_resp.status_code = 200 then (v_json ->> 'apagados')::integer end,
      falhas = case when v_resp.status_code = 200 then (v_json ->> 'falhas')::integer end,
      erro = case
        when v_resp.timed_out then 'tempo_esgotado'
        when v_resp.status_code is null then left(coalesce(v_resp.error_msg, 'falha_de_rede'), 200)
        when v_resp.status_code <> 200 then left(coalesce(v_json ->> 'error', 'http_' || v_resp.status_code), 200)
      end,
      concluido_em = now()
    where id = v_run.id;
    v_feitas := v_feitas + 1;
  end loop;
  return v_feitas;
end;
$$;

create function private.start_media_cleanup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_anon text;
  v_secret text;
  v_request bigint;
begin
  perform private.collect_media_cleanup();
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'barberia_media_migrate_url';
  select s.decrypted_secret into v_anon from vault.decrypted_secrets s where s.name = 'barberia_anon_key';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'barberia_media_migrate_secret';
  if coalesce(v_url, '') = '' or coalesce(v_anon, '') = '' or coalesce(v_secret, '') = '' then
    insert into private.media_cleanup_runs (erro, concluido_em) values ('segredo_ausente_no_vault', now());
    return null;
  end if;
  select net.http_post(
    url := v_url,
    body := jsonb_build_object('acao', 'limpar-orfaos'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'apikey', v_anon,
                                  'x-migrate-secret', v_secret),
    timeout_milliseconds := 120000
  ) into v_request;
  insert into private.media_cleanup_runs (request_id) values (v_request);
  return v_request;
end;
$$;

revoke all on function private.collect_media_cleanup(), private.start_media_cleanup() from public, anon, authenticated;

-- Agendamento (cron.schedule com o mesmo nome atualiza o job existente: reaplicar não duplica)
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('barberia-limpeza-midia', '0 6 * * *', 'select private.start_media_cleanup()');
    perform cron.schedule('barberia-limpeza-midia-resultado', '20 6 * * *', 'select private.collect_media_cleanup()');
  end if;
end;
$$;
commit;
