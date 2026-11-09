-- Barberia AI — migração 0006: outbox/inbox de eventos, WhatsApp, lembretes e consentimentos (F08-01 a F08-07)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0005. Testada localmente em supabase/tests/eventos.test.ts.
--
-- Esta migration NÃO envia mensagens. Ela só guarda o que deve ser enviado (outbox), o que chegou (inbox) e o
-- resultado. O envio é feito pelo worker de servidor (Edge Function com service_role) e fica BLOQUEADO enquanto a
-- barbearia não tiver canal WhatsApp ativo (integration_accounts) — nunca simulamos entrega.
-- Funções do worker/webhook só executam como service_role; o cliente da API nunca as chama.

--------------------------------------------------------------
-- Consentimentos (marketing separado dos avisos da reserva) com trilha de auditoria
--------------------------------------------------------------
create table public.customer_consents (
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  marketing boolean not null default false,
  opt_out_em timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (barbershop_id, profile_id)
);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('opt_in', 'opt_out')),
  origem text not null check (origem in ('app', 'reserva', 'whatsapp')),
  criado_em timestamptz not null default now()
);
create index idx_consent_events_profile on public.consent_events (barbershop_id, profile_id, criado_em);

-- registra a mudança de marketing (somente se houve mudança)
create function private.apply_marketing_consent(p_shop uuid, p_profile uuid, p_marketing boolean, p_origem text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes boolean;
begin
  select marketing into v_antes from public.customer_consents where barbershop_id = p_shop and profile_id = p_profile;
  if v_antes is null then
    if not p_marketing then
      return;
    end if;
    insert into public.customer_consents (barbershop_id, profile_id, marketing) values (p_shop, p_profile, true);
  elsif v_antes = p_marketing then
    return;
  else
    update public.customer_consents
    set marketing = p_marketing, atualizado_em = now(), opt_out_em = case when p_marketing then null else now() end
    where barbershop_id = p_shop and profile_id = p_profile;
  end if;
  insert into public.consent_events (barbershop_id, profile_id, tipo, origem)
  values (p_shop, p_profile, case when p_marketing then 'opt_in' else 'opt_out' end, p_origem);
end;
$$;
revoke all on function private.apply_marketing_consent(uuid, uuid, boolean, text) from public, anon, authenticated;

create function private.booking_consent_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.consent_marketing then
    perform private.apply_marketing_consent(new.barbershop_id, new.customer_id, true, 'reserva');
  end if;
  return new;
end;
$$;
create trigger bookings_consent after insert on public.bookings
  for each row execute function private.booking_consent_trigger();

create function public.set_marketing_consent(p_barbershop_id uuid, p_marketing boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member(p_barbershop_id) or p_marketing is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.apply_marketing_consent(p_barbershop_id, auth.uid(), p_marketing, 'app');
end;
$$;

-- Números que pediram PARAR (qualquer aviso). O WhatsApp informado na reserva não é verificado, então o titular
-- do número precisa de um jeito de parar tudo. Sem nenhum acesso pela API: só as funções de servidor leem e gravam.
create table public.phone_blocklist (
  telefone text primary key check (telefone ~ '^[0-9]{10}$'),
  criado_em timestamptz not null default now()
);
revoke all on table public.phone_blocklist from public, anon, authenticated;
alter table public.phone_blocklist enable row level security;

--------------------------------------------------------------
-- Canais de integração (sem segredos: credenciais ficam só nos secrets do servidor)
--------------------------------------------------------------
create table public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  provider text not null check (provider in ('whatsapp')),
  status text not null default 'nao_configurado' check (status in ('nao_configurado', 'ativo', 'suspenso')),
  atualizado_em timestamptz not null default now(),
  unique (barbershop_id, provider)
);

--------------------------------------------------------------
-- Outbox (o que enviar) e logs de envio
--------------------------------------------------------------
create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  customer_id uuid references public.profiles(id) on delete set null,
  tipo text not null,
  canal text not null default 'whatsapp' check (canal in ('whatsapp')),
  destino text not null,
  payload jsonb not null default '{}',
  dedup_key text not null unique,
  status text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviado', 'falhou', 'bloqueado', 'cancelado')),
  tentativas integer not null default 0,
  max_tentativas integer not null default 5 check (max_tentativas between 1 and 10),
  proximo_envio timestamptz not null default now(),
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index idx_outbox_fila on public.outbox_events (status, proximo_envio);
create index idx_outbox_booking on public.outbox_events (booking_id);
create index idx_outbox_shop on public.outbox_events (barbershop_id, criado_em);

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.outbox_events(id) on delete cascade,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  status text not null check (status in ('enviado', 'falhou')),
  provider_message_id text,
  erro text check (erro is null or length(erro) <= 300),
  criado_em timestamptz not null default now()
);
create index idx_notification_logs_msg on public.notification_logs (provider_message_id);
create index idx_notification_logs_outbox on public.notification_logs (outbox_id);

--------------------------------------------------------------
-- Inbox (o que chegou): deduplicação por (provedor, id do evento)
--------------------------------------------------------------
create table public.inbound_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null check (length(event_id) between 1 and 200),
  barbershop_id uuid references public.barbershops(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  ts_evento timestamptz,
  status text not null default 'ignorado' check (status in ('processado', 'ignorado', 'rejeitado')),
  motivo text,
  recebido_em timestamptz not null default now(),
  unique (provider, event_id)
);
create index idx_inbound_recebido on public.inbound_webhook_events (provider, recebido_em);

--------------------------------------------------------------
-- Privilégios e RLS (leitura só pela gestão)
--------------------------------------------------------------
revoke all on table public.customer_consents, public.consent_events, public.integration_accounts,
  public.outbox_events, public.notification_logs, public.inbound_webhook_events from public, anon, authenticated;
grant select on public.customer_consents, public.consent_events, public.integration_accounts,
  public.outbox_events, public.notification_logs, public.inbound_webhook_events to authenticated;

alter table public.customer_consents enable row level security;
alter table public.consent_events enable row level security;
alter table public.integration_accounts enable row level security;
alter table public.outbox_events enable row level security;
alter table public.notification_logs enable row level security;
alter table public.inbound_webhook_events enable row level security;

create policy customer_consents_select on public.customer_consents
  for select to authenticated
  using (profile_id = auth.uid() or private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy consent_events_select on public.consent_events
  for select to authenticated
  using (profile_id = auth.uid() or private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy integration_accounts_select on public.integration_accounts
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy outbox_events_select on public.outbox_events
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy notification_logs_select on public.notification_logs
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));
create policy inbound_webhook_events_select on public.inbound_webhook_events
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

--------------------------------------------------------------
-- Eventos da reserva → outbox (na mesma transação do evento; deduplicado)
--------------------------------------------------------------
create function private.enqueue_booking_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  v_tipo text;
  v_prof text;
  v_shop public.barbershops%rowtype;
  v_consent boolean;
begin
  v_tipo := case
    when new.tipo = 'created' then 'reserva_criada'
    when new.tipo = 'cancelled' then 'reserva_cancelada'
    when new.tipo = 'rescheduled' then 'reserva_reagendada'
    when new.tipo = 'status' and new.detalhes ->> 'para' = 'confirmado' then 'reserva_confirmada'
    when new.tipo = 'status' and new.detalhes ->> 'para' = 'concluido' then 'atendimento_concluido'
    else null
  end;
  if v_tipo is null then
    return new;
  end if;
  select * into b from public.bookings where id = new.booking_id;
  select nome into v_prof from public.professionals where id = b.professional_id;
  select * into v_shop from public.barbershops where id = b.barbershop_id;
  v_consent := b.consent_lembretes;

  if v_tipo = 'reserva_cancelada' then
    update public.outbox_events
    set status = 'cancelado', ultimo_erro = 'reserva_cancelada', atualizado_em = now()
    where booking_id = b.id and status in ('pendente', 'bloqueado')
      and (tipo like 'lembrete%' or tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_reagendada'));
  end if;

  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key, status, ultimo_erro)
  values (
    b.barbershop_id, b.id, b.customer_id, v_tipo, b.cliente_whatsapp,
    jsonb_build_object(
      'booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', v_prof,
      'inicio', b.inicio, 'fim', b.fim, 'fuso', v_shop.fuso, 'barbearia', v_shop.nome, 'endereco', v_shop.endereco
    ),
    b.id || ':' || v_tipo || ':' || new.id,
    case when v_consent then 'pendente' else 'cancelado' end,
    case when v_consent then null else 'sem_consentimento' end
  )
  on conflict (dedup_key) do nothing;
  return new;
end;
$$;
create trigger booking_events_outbox after insert on public.booking_events
  for each row execute function private.enqueue_booking_event();

--------------------------------------------------------------
-- Worker (service_role): reivindicar, concluir, liberar bloqueados
--------------------------------------------------------------
create function public.claim_outbox(p_limit integer default 20)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    p_limit := 20;
  end if;
  -- envios que ficaram presos (worker caiu) voltam para a fila
  update public.outbox_events set status = 'pendente', atualizado_em = now()
  where status = 'enviando' and atualizado_em < now() - interval '10 minutes';

  -- recuperação de clientes: opt-out vale até o último instante
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

  -- sem canal ativo: nada é enviado nem simulado
  update public.outbox_events e
  set status = 'bloqueado', ultimo_erro = 'canal_nao_configurado', atualizado_em = now()
  where e.status = 'pendente' and e.proximo_envio <= now()
    and not exists (
      select 1 from public.integration_accounts i
      where i.barbershop_id = e.barbershop_id and i.provider = 'whatsapp' and i.status = 'ativo'
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

create function public.complete_outbox(p_id uuid, p_ok boolean, p_provider_message_id text, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.outbox_events%rowtype;
  v_erro text := left(p_erro, 300);
begin
  select * into e from public.outbox_events where id = p_id for update;
  if e.id is null or e.status <> 'enviando' then
    return; -- evento inexistente ou já finalizado: nunca regride
  end if;
  if p_ok then
    update public.outbox_events set status = 'enviado', ultimo_erro = null, atualizado_em = now() where id = e.id;
    insert into public.notification_logs (outbox_id, barbershop_id, status, provider_message_id)
    values (e.id, e.barbershop_id, 'enviado', left(p_provider_message_id, 200));
  else
    update public.outbox_events
    set status = case when e.tentativas >= e.max_tentativas then 'falhou' else 'pendente' end,
        ultimo_erro = v_erro,
        proximo_envio = now() + make_interval(mins => least(power(2, e.tentativas)::integer, 120)),
        atualizado_em = now()
    where id = e.id;
    insert into public.notification_logs (outbox_id, barbershop_id, status, erro)
    values (e.id, e.barbershop_id, 'falhou', v_erro);
  end if;
end;
$$;

create function public.set_integration_status(p_barbershop_id uuid, p_provider text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('nao_configurado', 'ativo', 'suspenso') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  insert into public.integration_accounts (barbershop_id, provider, status)
  values (p_barbershop_id, p_provider, p_status)
  on conflict (barbershop_id, provider) do update set status = excluded.status, atualizado_em = now();
end;
$$;

create function public.release_blocked_outbox(p_barbershop_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.outbox_events
  set status = 'pendente', ultimo_erro = null, proximo_envio = now(), atualizado_em = now()
  where barbershop_id = p_barbershop_id and status = 'bloqueado';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

--------------------------------------------------------------
-- Lembretes (24h e 2h) e recuperação (30/45/60 dias)
--------------------------------------------------------------
create function public.schedule_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_i integer;
begin
  -- 24h: só quando a reserva foi feita com mais de 24h de antecedência e ainda faltam mais de 2h
  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
  select b.barbershop_id, b.id, b.customer_id, 'lembrete_24h', b.cliente_whatsapp,
         jsonb_build_object('booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', p.nome,
           'inicio', b.inicio, 'fim', b.fim, 'fuso', s.fuso, 'barbearia', s.nome, 'endereco', s.endereco),
         b.id || ':lembrete_24h:' || extract(epoch from b.inicio)::bigint
  from public.bookings b
  join public.professionals p on p.id = b.professional_id
  join public.barbershops s on s.id = b.barbershop_id
  where b.status = 'confirmado' and b.consent_lembretes
    and b.inicio > now() + interval '2 hours'
    and b.inicio - interval '24 hours' <= now()
    and b.criado_em <= b.inicio - interval '24 hours'
  on conflict (dedup_key) do nothing;
  get diagnostics v_i = row_count;
  v_n := v_n + v_i;

  -- 2h: quando faltam entre 15 minutos e 2 horas
  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
  select b.barbershop_id, b.id, b.customer_id, 'lembrete_2h', b.cliente_whatsapp,
         jsonb_build_object('booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', p.nome,
           'inicio', b.inicio, 'fim', b.fim, 'fuso', s.fuso, 'barbearia', s.nome, 'endereco', s.endereco),
         b.id || ':lembrete_2h:' || extract(epoch from b.inicio)::bigint
  from public.bookings b
  join public.professionals p on p.id = b.professional_id
  join public.barbershops s on s.id = b.barbershop_id
  where b.status = 'confirmado' and b.consent_lembretes
    and b.inicio > now() + interval '15 minutes'
    and b.inicio - interval '2 hours' <= now()
  on conflict (dedup_key) do nothing;
  get diagnostics v_i = row_count;
  v_n := v_n + v_i;
  return v_n;
end;
$$;

create function public.schedule_reactivation()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with ultimo as (
    select distinct on (b.barbershop_id, b.customer_id)
      b.barbershop_id, b.customer_id, b.id as booking_id, b.cliente_whatsapp, b.cliente_nome, b.inicio,
      floor(extract(epoch from now() - b.inicio) / 86400)::integer as dias
    from public.bookings b
    where b.status = 'concluido'
    order by b.barbershop_id, b.customer_id, b.inicio desc
  ),
  etapa as (
    select u.*, (
      select max(n) from unnest(array[30, 45, 60]) n where u.dias >= n and u.dias < n + 7
    ) as n
    from ultimo u
  )
  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
  select e.barbershop_id, e.booking_id, e.customer_id, 'reativacao_' || e.n, e.cliente_whatsapp,
         jsonb_build_object('cliente', e.cliente_nome, 'dias', e.dias, 'barbearia', s.nome, 'fuso', s.fuso),
         'reativacao_' || e.n || ':' || e.barbershop_id || ':' || e.customer_id || ':' || e.booking_id
  from etapa e
  join public.barbershops s on s.id = e.barbershop_id
  join public.customer_consents c on c.barbershop_id = e.barbershop_id and c.profile_id = e.customer_id and c.marketing
  where e.n is not null
    and not exists (
      select 1 from public.bookings f
      where f.barbershop_id = e.barbershop_id and f.customer_id = e.customer_id
        and f.status in ('pendente', 'confirmado') and f.inicio > now()
    )
  on conflict (dedup_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

--------------------------------------------------------------
-- Webhook de entrada (service_role): replay, duplicidade, limite e correlação segura
--------------------------------------------------------------
create function public.process_whatsapp_reply(
  p_event_id text, p_ts timestamptz, p_from text, p_context_message_id text, p_texto text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_provider constant text := 'whatsapp';
  v_inbound uuid;
  v_texto text := translate(lower(btrim(coalesce(p_texto, ''))), 'ãáâàéêíóôõúç', 'aaaaeeiooouc');
  v_fone text := right(regexp_replace(coalesce(p_from, ''), '\D', '', 'g'), 10);
  v_out public.outbox_events%rowtype;
  b public.bookings%rowtype;
  v_window integer;
  v_status text := 'ignorado';
  v_motivo text;
  v_n integer;
begin
  if (select count(*) from public.inbound_webhook_events
      where provider = c_provider and recebido_em > now() - interval '1 minute') >= 300 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.inbound_webhook_events (provider, event_id, ts_evento)
  values (c_provider, p_event_id, p_ts)
  on conflict (provider, event_id) do nothing
  returning id into v_inbound;
  if v_inbound is null then
    return 'duplicado';
  end if;

  if p_ts is null or p_ts < now() - interval '5 minutes' or p_ts > now() + interval '1 minute' then
    update public.inbound_webhook_events set status = 'rejeitado', motivo = 'replay' where id = v_inbound;
    return 'rejeitado';
  end if;

  if length(v_fone) < 10 then
    update public.inbound_webhook_events set motivo = 'telefone_invalido' where id = v_inbound;
    return 'ignorado';
  end if;

  if v_texto = 'parar' then
    insert into public.phone_blocklist (telefone) values (v_fone) on conflict do nothing;
    v_n := 0;
    perform private.apply_marketing_consent(x.barbershop_id, x.customer_id, false, 'whatsapp')
    from (select distinct barbershop_id, customer_id from public.bookings where right(cliente_whatsapp, 10) = v_fone) x;
    get diagnostics v_n = row_count;
    update public.inbound_webhook_events set status = 'processado', motivo = 'opt_out' where id = v_inbound;
    return 'processado';
  end if;

  if v_texto not in ('sim', 'nao') then
    update public.inbound_webhook_events set motivo = 'resposta_invalida' where id = v_inbound;
    return 'ignorado';
  end if;

  -- correlação: a resposta precisa citar uma mensagem que NÓS enviamos para esta reserva
  select o.* into v_out
  from public.notification_logs l
  join public.outbox_events o on o.id = l.outbox_id
  where l.provider_message_id = p_context_message_id and l.status = 'enviado'
    and o.tipo in ('reserva_criada', 'reserva_reagendada', 'lembrete_24h', 'lembrete_2h')
  limit 1;
  if v_out.id is null or v_out.booking_id is null then
    update public.inbound_webhook_events set motivo = 'sem_correlacao' where id = v_inbound;
    return 'ignorado';
  end if;

  select * into b from public.bookings where id = v_out.booking_id for update;
  update public.inbound_webhook_events set barbershop_id = b.barbershop_id, booking_id = b.id where id = v_inbound;
  if right(b.cliente_whatsapp, 10) <> v_fone then
    update public.inbound_webhook_events set motivo = 'telefone_divergente' where id = v_inbound;
    return 'ignorado';
  end if;
  if (v_out.payload ->> 'inicio')::timestamptz is distinct from b.inicio then
    update public.inbound_webhook_events set motivo = 'desatualizado' where id = v_inbound;
    return 'ignorado';
  end if;
  if b.status not in ('pendente', 'confirmado') then
    update public.inbound_webhook_events set motivo = 'estado_final' where id = v_inbound;
    return 'ignorado';
  end if;

  if v_texto = 'sim' then
    if b.status = 'confirmado' then
      update public.inbound_webhook_events set motivo = 'ja_confirmado' where id = v_inbound;
      return 'ignorado';
    end if;
    update public.bookings set status = 'confirmado' where id = b.id;
    insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
    values (b.id, b.barbershop_id, null, 'status', jsonb_build_object('de', b.status, 'para', 'confirmado', 'via', 'whatsapp'));
  else
    select cancel_window_min into v_window from public.barbershops where id = b.barbershop_id;
    if b.inicio - now() < make_interval(mins => v_window) then
      update public.inbound_webhook_events set motivo = 'fora_da_janela' where id = v_inbound;
      return 'ignorado';
    end if;
    -- reserva com pagamento recebido não é cancelada por resposta de WhatsApp: a gestão estorna antes
    if (select coalesce(sum(p.valor_centavos), 0) from public.payments p where p.booking_id = b.id)
       - (select coalesce(sum(r.valor_centavos), 0) from public.refunds r join public.payments p2 on p2.id = r.payment_id where p2.booking_id = b.id) > 0 then
      update public.inbound_webhook_events set motivo = 'com_pagamento' where id = v_inbound;
      return 'ignorado';
    end if;
    delete from public.occupancies where id = b.occupancy_id;
    update public.bookings set status = 'cancelado', occupancy_id = null where id = b.id;
    insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
    values (b.id, b.barbershop_id, null, 'cancelled', jsonb_build_object('por', 'whatsapp'));
  end if;
  update public.inbound_webhook_events set status = 'processado', motivo = v_texto where id = v_inbound;
  return 'processado';
end;
$$;

--------------------------------------------------------------
-- Painel: apagar uma mensagem (gestão). Remove o evento e seus registros de envio; NÃO mexe na reserva nem no financeiro.
--------------------------------------------------------------
create function public.delete_outbox_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.outbox_events%rowtype;
begin
  select * into e from public.outbox_events where id = p_id for update;
  if e.id is null or not private.has_role(e.barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if e.status = 'enviando' then
    raise exception 'in_flight' using errcode = 'P0001'; -- o worker está enviando agora
  end if;
  delete from public.outbox_events where id = e.id; -- notification_logs sai junto (on delete cascade)
  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (e.barbershop_id, auth.uid(), 'outbox.deleted', jsonb_build_object('tipo', e.tipo, 'booking_id', e.booking_id));
end;
$$;

--------------------------------------------------------------
-- Painel: resumo de envios (gestão)
--------------------------------------------------------------
create function public.outbox_summary(p_barbershop_id uuid)
returns table (status text, total bigint)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select e.status, count(*) from public.outbox_events e where e.barbershop_id = p_barbershop_id group by e.status order by e.status;
end;
$$;

--------------------------------------------------------------
-- Permissões das funções
--------------------------------------------------------------
revoke all on function
  public.claim_outbox(integer),
  public.complete_outbox(uuid, boolean, text, text),
  public.set_integration_status(uuid, text, text),
  public.release_blocked_outbox(uuid),
  public.schedule_reminders(),
  public.schedule_reactivation(),
  public.process_whatsapp_reply(text, timestamptz, text, text, text)
from public, anon, authenticated;
grant execute on function
  public.claim_outbox(integer),
  public.complete_outbox(uuid, boolean, text, text),
  public.set_integration_status(uuid, text, text),
  public.release_blocked_outbox(uuid),
  public.schedule_reminders(),
  public.schedule_reactivation(),
  public.process_whatsapp_reply(text, timestamptz, text, text, text)
to service_role;

revoke all on function public.set_marketing_consent(uuid, boolean), public.outbox_summary(uuid), public.delete_outbox_event(uuid) from public, anon;
grant execute on function public.set_marketing_consent(uuid, boolean), public.outbox_summary(uuid), public.delete_outbox_event(uuid) to authenticated;
