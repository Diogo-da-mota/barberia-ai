-- Cópia de supabase/migrations/0057_saida_exclusao_equipe.sql para o banco remoto. Saída da barbearia e exclusão da conta da equipe.
--   ORDEM: 1) publicar o front; 2) supabase db query --remote --yes -f supabase/aplicar/0057.sql
-- Conferir depois, só leitura:
--   select has_function_privilege('anon', 'public.leave_barbershop(uuid)', 'EXECUTE'), has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE');  (esperado: false, false)
--   select count(*) from public.account_deletion_requests;  (esperado: 0)
--   select count(*) from public.professionals where desligado_em is not null;  (esperado: 0)
begin;
-- Barberia AI — migração 0057: barbeiro sai da barbearia e exclusão da conta da equipe (LGPD, arts. 15, 16 e 18).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0001–0056. Testada em supabase/tests/sair-excluir-conta.test.ts e
-- supabase/tests/excluir-conta.test.ts. Nenhum dado existente muda ao aplicar: uma coluna vazia, uma tabela vazia, um gatilho
-- e funções. Publicar o front ANTES (ele já trata 'reauth_required' e mostra "atualização pendente" sem esta migration).
--
-- Em todas as funções a pessoa vem só do token (auth.uid()); nenhuma recebe id de conta, de card ou de vínculo.
--
-- 1. public.leave_barbershop(barbearia): barbeiro ou gerente sai de UMA barbearia. Remove o vínculo de equipe; o card dele
--    nessa barbearia fica inativo e sem conta (o gatilho da 0038/0043 encerra o Google Agenda) e marcado como desligado;
--    convites pendentes para o e-mail dele nessa barbearia expiram. Reservas, comissões, repasses e pagamentos ficam com a
--    barbearia, ligados ao card. Reservas futuras do card continuam para a gestão reagendar com outro profissional ou
--    cancelar (o cliente não é avisado automaticamente). Proprietário não sai por aqui ('owner_cannot_leave'). Outras
--    barbearias, a conta e as reservas como cliente não mudam. Repetir devolve 'ja_saiu' sem mudar nada.
-- 2. public.get_leave_summary(barbearia): o que a pessoa precisa saber antes de sair (só dados do próprio card).
-- 3. professionals.desligado_em + gatilho: o card de quem saiu (ou excluiu a conta) não volta a receber reservas no nome da
--    pessoa sem uma conta ligada de novo (novo convite aceito ou vínculo pela gestão). Reativar sem conta: 'professional_left'.
-- 4. public.delete_my_account() (mesma assinatura da 0056) passa a:
--    - exigir login recente (até 15 min, primeiro fator no claim amr do token assinado pelo Supabase): 'reauth_required';
--    - ser idempotente (conta já excluída → nada) e serializar com reservas, convites e a saída (travas da conta e do perfil);
--    - tratar a equipe em TODAS as barbearias: card inativo, sem conta, sem foto, telefone e e-mail; nome e documento ficam
--      para o histórico financeiro da barbearia (art. 16, I); o mesmo nos cards de onde já tinha saído (mesmo e-mail
--      confirmado); convites pendentes do e-mail confirmado saem, os aceitos e os registros de convite ficam sem o e-mail;
--    - registrar o atendimento em account_deletion_requests sem identificar a pessoa (profile_id vira null na exclusão).
--    Continua recusando dono de barbearia e reserva futura como cliente; então a pessoa registra o pedido (5).
-- 5. account_deletion_requests + public.request_account_deletion(): pedido de exclusão para atendimento manual quando a
--    exclusão automática não pode ser concluída. Um pendente por conta; repetir devolve o mesmo pedido.

--------------------------------------------------------------
-- Login recente (reautenticação)
--------------------------------------------------------------
-- amr = métodos de autenticação da SESSÃO com o horário do login; a renovação do token não muda o horário (providers.tsx).
-- O token é assinado pelo Supabase Auth: o navegador não consegue forjar o amr. Vale só o PRIMEIRO fator (senha, Google,
-- código ou link do e-mail): um fator de MFA (totp, phone) cadastrado e verificado com a sessão já aberta não prova quem é a
-- pessoa (quem tem só o token conseguiria). Horário no futuro não conta.
create function private.recent_auth(p_max interval default interval '15 minutes')
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_ts double precision;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    select max((e ->> 'timestamp')::double precision) into v_ts
    from jsonb_array_elements(case when jsonb_typeof(v_claims -> 'amr') = 'array' then v_claims -> 'amr' else '[]'::jsonb end) e
    where e ->> 'method' in ('password', 'oauth', 'otp', 'magiclink', 'recovery', 'email/signup');
  exception when others then
    return false;
  end;
  return v_ts is not null and to_timestamp(v_ts) > now() - p_max and to_timestamp(v_ts) <= now() + interval '1 minute';
end;
$$;

revoke all on function private.recent_auth(interval) from public, anon, authenticated;

--------------------------------------------------------------
-- Card de quem saiu
--------------------------------------------------------------
alter table public.professionals add column desligado_em timestamptz;
-- Sem grant: a coluna não é lida nem gravada pela API (só pelas funções abaixo).

create function private.professional_left_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Uma conta ligada de novo (convite aceito ou vínculo pela gestão) encerra a marca de desligamento.
  if new.profile_id is not null and old.profile_id is distinct from new.profile_id then
    new.desligado_em := null;
  end if;
  if new.ativo and not old.ativo and new.desligado_em is not null and new.profile_id is null then
    raise exception 'professional_left' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.professional_left_guard() from public, anon, authenticated;

create trigger professionals_left_guard
  before update of ativo, profile_id on public.professionals
  for each row execute function private.professional_left_guard();

--------------------------------------------------------------
-- Pedidos de exclusão (atendimento manual e registro do atendimento)
--------------------------------------------------------------
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente', 'concluido', 'cancelado')),
  origem text not null check (origem in ('pedido', 'automatica')),
  bloqueios text[] not null default '{}' check (bloqueios <@ array['proprietario', 'reservas_futuras']),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz
);

create unique index uq_account_deletion_pending on public.account_deletion_requests (profile_id) where status = 'pendente';

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant select on public.account_deletion_requests to authenticated;

create policy account_deletion_requests_select on public.account_deletion_requests
  for select to authenticated using (profile_id = auth.uid());

create function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.account_deletion_requests%rowtype;
  v_bloqueios text[];
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('conta:' || v_uid::text, 0));

  select * into v_row from public.account_deletion_requests where profile_id = v_uid and status = 'pendente';
  if v_row.id is null then
    v_bloqueios := array_remove(array[
      case when exists (select 1 from public.barbershops b where b.owner_id = v_uid) then 'proprietario' end,
      case when exists (select 1 from public.bookings b where b.customer_id = v_uid and b.status in ('pendente', 'confirmado') and b.fim > now())
        then 'reservas_futuras' end
    ], null);
    insert into public.account_deletion_requests (profile_id, origem, bloqueios)
    values (v_uid, 'pedido', v_bloqueios)
    returning * into v_row;
  end if;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'bloqueios', to_jsonb(v_row.bloqueios), 'criado_em', v_row.criado_em);
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

--------------------------------------------------------------
-- Sair de uma barbearia
--------------------------------------------------------------
create function public.get_leave_summary(p_barbershop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_papel text;
  v_cards uuid[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select m.papel into v_papel from public.memberships m where m.barbershop_id = p_barbershop_id and m.profile_id = v_uid;
  if v_papel is null or v_papel = 'cliente' then
    return jsonb_build_object('papel', null, 'pode_sair', false);
  end if;
  select coalesce(array_agg(p.id), '{}') into v_cards
  from public.professionals p where p.barbershop_id = p_barbershop_id and p.profile_id = v_uid;

  return jsonb_build_object(
    'papel', v_papel,
    'pode_sair', v_papel in ('barbeiro', 'gerente'),
    'reservas_futuras', (select count(*) from public.bookings b
      where b.professional_id = any(v_cards) and b.status in ('pendente', 'confirmado') and b.fim > now()),
    'comissoes_a_receber_centavos', (select coalesce(sum(c.valor_centavos), 0) from public.commissions c
      where c.professional_id = any(v_cards) and c.status = 'provisionada' and c.payout_id is null),
    'google_agenda', exists (select 1 from public.calendar_connections cc
      where cc.professional_id = any(v_cards) and cc.status <> 'desvinculado')
  );
end;
$$;

revoke all on function public.get_leave_summary(uuid) from public, anon;
grant execute on function public.get_leave_summary(uuid) to authenticated;

create function public.leave_barbershop(p_barbershop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_papel text;
  v_email text;
  v_cards uuid[];
  v_futuras integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- Saídas repetidas ou simultâneas (e saída × exclusão da conta) acontecem uma depois da outra.
  perform pg_advisory_xact_lock(hashtextextended('conta:' || v_uid::text, 0));

  select m.papel into v_papel from public.memberships m
  where m.barbershop_id = p_barbershop_id and m.profile_id = v_uid
  for update;
  if v_papel = 'proprietario' then
    raise exception 'owner_cannot_leave' using errcode = 'P0001';
  end if;
  if v_papel is null or v_papel = 'cliente' then
    return jsonb_build_object('status', 'ja_saiu', 'reservas_futuras', 0);
  end if;

  perform 1 from public.professionals p where p.barbershop_id = p_barbershop_id and p.profile_id = v_uid for update;
  select coalesce(array_agg(p.id), '{}') into v_cards
  from public.professionals p where p.barbershop_id = p_barbershop_id and p.profile_id = v_uid;
  select count(*) into v_futuras from public.bookings b
  where b.professional_id = any(v_cards) and b.status in ('pendente', 'confirmado') and b.fim > now();

  update public.professionals set ativo = false, profile_id = null, desligado_em = now() where id = any(v_cards);
  delete from public.memberships where barbershop_id = p_barbershop_id and profile_id = v_uid;

  -- Um convite antigo ainda válido não devolve o acesso sem uma nova decisão da barbearia.
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is not null then
    update public.invites set expires_at = now()
    where barbershop_id = p_barbershop_id and aceito_em is null and expires_at > now() and lower(btrim(email)) = v_email;
  end if;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (p_barbershop_id, v_uid, 'member.left',
    jsonb_build_object('papel', v_papel, 'origem', 'saida', 'professional_ids', to_jsonb(v_cards), 'reservas_futuras', v_futuras));

  return jsonb_build_object('status', 'saiu', 'reservas_futuras', v_futuras);
end;
$$;

revoke all on function public.leave_barbershop(uuid) from public, anon;
grant execute on function public.leave_barbershop(uuid) to authenticated;

--------------------------------------------------------------
-- Excluir a própria conta (substitui a 0056; mesma assinatura)
--------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_cards uuid[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Mesma trava de create_booking (0049): uma reserva nova da pessoa não entra no meio da exclusão.
  perform pg_advisory_xact_lock(hashtextextended('create_booking:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('conta:' || v_uid::text, 0));

  select case when u.email_confirmed_at is not null then lower(btrim(u.email)) end into v_email
  from auth.users u where u.id = v_uid;
  if not found then
    return; -- já excluída (pedido repetido ou token antigo): nada a fazer
  end if;
  -- Convites do e-mail primeiro e só depois o perfil: a mesma ordem de accept_invite (convite → perfil), sem impasse.
  perform 1 from public.invites i where v_email is not null and lower(btrim(i.email)) = v_email for update;
  -- Trava o perfil: tudo o que liga algo à conta (aceitar convite, card ligado pela gestão, reserva, link_my_bookings) passa
  -- pela FK de profiles e espera esta transação; o que já estava em andamento termina antes e entra na limpeza abaixo.
  perform 1 from public.profiles p where p.id = v_uid for update;
  if not private.recent_auth() then
    raise exception 'reauth_required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.barbershops b where b.owner_id = v_uid) then
    raise exception 'owner_cannot_delete' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bookings b where b.customer_id = v_uid and b.status in ('pendente', 'confirmado') and b.fim > now()) then
    raise exception 'has_upcoming_bookings' using errcode = 'P0001';
  end if;

  -- Equipe, em todas as barbearias: o card fica com a barbearia (histórico e financeiro), inativo e sem a conta.
  perform 1 from public.professionals p where p.profile_id = v_uid for update;
  select coalesce(array_agg(p.id), '{}') into v_cards from public.professionals p where p.profile_id = v_uid;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  select m.barbershop_id, null, 'member.left', jsonb_build_object(
    'papel', m.papel, 'origem', 'conta_excluida',
    'professional_ids', (select coalesce(jsonb_agg(p.id), '[]'::jsonb) from public.professionals p where p.id = any(v_cards) and p.barbershop_id = m.barbershop_id),
    'reservas_futuras', (select count(*) from public.bookings b join public.professionals p on p.id = b.professional_id
      where p.id = any(v_cards) and p.barbershop_id = m.barbershop_id and b.status in ('pendente', 'confirmado') and b.fim > now()))
  from public.memberships m
  where m.profile_id = v_uid and m.papel in ('gerente', 'barbeiro');

  update public.professionals
  set ativo = false, profile_id = null, desligado_em = coalesce(desligado_em, now()), avatar_path = null, telefone = null, email = null
  where id = any(v_cards);

  if v_email is not null then
    -- Cards de barbearias de onde a pessoa já tinha saído (sem conta, desligados, com o e-mail confirmado dela): mesma limpeza.
    update public.professionals
    set avatar_path = null, telefone = null, email = null
    where profile_id is null and desligado_em is not null and lower(btrim(email)) = v_email;
    delete from public.invites where aceito_em is null and lower(btrim(email)) = v_email;
    update public.invites set email = 'removido' where aceito_em is not null and lower(btrim(email)) = v_email;
    update public.audit_logs set detalhes = detalhes || jsonb_build_object('email', 'removido')
    where acao in ('invite.created', 'invite.renewed') and lower(btrim(detalhes ->> 'email')) = v_email;
  end if;

  -- Cliente (0056, sem mudança): avisos cancelados e sem telefone; reservas antigas sem dono, nome, WhatsApp e e-mail.
  update public.outbox_events o
  set status = case when o.status in ('pendente', 'enviando') then 'cancelado' else o.status end,
      destino = 'removido', payload = '{}'::jsonb, atualizado_em = now()
  where o.customer_id = v_uid or o.booking_id in (select b.id from public.bookings b where b.customer_id = v_uid);

  update public.bookings b
  set customer_id = null, cliente_nome = 'Cliente removido', cliente_whatsapp = '', cliente_email = null
  where b.customer_id = v_uid;

  update public.media_uploads set enviado_por = null where enviado_por = v_uid;

  -- Registro do atendimento, sem a pessoa: profile_id vira null quando a conta sai (on delete set null).
  update public.account_deletion_requests
  set status = 'concluido', concluido_em = now(), atualizado_em = now()
  where profile_id = v_uid and status = 'pendente';
  if not found then
    insert into public.account_deletion_requests (profile_id, status, origem, concluido_em)
    values (v_uid, 'concluido', 'automatica', now());
  end if;

  -- Login, perfil, vínculos, consentimentos e sessões (auth.sessions/refresh tokens) saem em cascata, na mesma transação.
  delete from auth.users u where u.id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
commit;
