-- Barberia AI — migração 0009: Google Calendar por profissional (F10-01 a F10-04)
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Depende de 0001 a 0006. Testada localmente em supabase/tests/calendario.test.ts.
--
-- POLÍTICA (decisão registrada): sincronização UNIDIRECIONAL, Barberia AI → Google. A reserva é a fonte da verdade.
--  * Eventos criados no Google NUNCA bloqueiam horários nem viram reservas (não existe caminho de entrada).
--  * Login com Google não dá acesso ao Calendar: o vínculo exige consentimento próprio, com o escopo mínimo
--    `calendar.events`, iniciado pela própria pessoa (nem a gestão consegue vincular o calendário de alguém).
--  * Tokens ficam em tabela sem nenhum privilégio para a API; só funções de servidor (service_role) os leem.
--  * Falha do Google nunca altera a reserva: a sincronização passa pelo outbox, com tentativas e espera.
--  * Desvincular apaga o token, marca os mapeamentos e para de gerar eventos; eventos já criados no Google permanecem.

alter table public.integration_accounts drop constraint integration_accounts_provider_check;
alter table public.integration_accounts add constraint integration_accounts_provider_check check (provider in ('whatsapp', 'google_calendar'));
alter table public.outbox_events drop constraint outbox_events_canal_check;
alter table public.outbox_events add constraint outbox_events_canal_check check (canal in ('whatsapp', 'google_calendar'));

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  professional_id uuid not null unique,
  status text not null default 'aguardando_consentimento' check (status in ('aguardando_consentimento', 'ativo', 'desvinculado')),
  calendar_id text,
  escopos text[] not null default '{}',
  state_hash text,
  state_expira_em timestamptz,
  consentido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  foreign key (professional_id, barbershop_id) references public.professionals (id, barbershop_id) on delete cascade
);

-- sem nenhum privilégio para a API: somente funções security definer chamadas pelo servidor
create table public.calendar_credentials (
  professional_id uuid primary key references public.professionals(id) on delete cascade,
  refresh_token text not null,
  atualizado_em timestamptz not null default now()
);

create table public.calendar_event_links (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  connection_id uuid not null references public.calendar_connections(id) on delete cascade,
  external_event_id text,
  etag text,
  status text not null default 'sincronizado' check (status in ('sincronizado', 'removido', 'desvinculado', 'erro')),
  ultimo_erro text,
  atualizado_em timestamptz not null default now()
);
create index idx_calendar_links_connection on public.calendar_event_links (connection_id);

revoke all on table public.calendar_connections, public.calendar_credentials, public.calendar_event_links from public, anon, authenticated;
grant select (id, barbershop_id, professional_id, status, calendar_id, escopos, consentido_em, criado_em, atualizado_em)
  on public.calendar_connections to authenticated;
grant select on public.calendar_event_links to authenticated;
alter table public.calendar_connections enable row level security;
alter table public.calendar_credentials enable row level security;
alter table public.calendar_event_links enable row level security;
create policy calendar_connections_select on public.calendar_connections
  for select to authenticated
  using (private.has_role(barbershop_id, array['proprietario', 'gerente']) or private.is_my_professional(professional_id));
create policy calendar_event_links_select on public.calendar_event_links
  for select to authenticated using (private.has_role(barbershop_id, array['proprietario', 'gerente']));

--------------------------------------------------------------
-- Vínculo com consentimento (F10-01/02)
--------------------------------------------------------------
-- o próprio usuário descobre qual profissional é o dele (profile_id não é legível pela API)
create function public.my_professional(p_barbershop_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.professionals where barbershop_id = p_barbershop_id and profile_id = auth.uid() limit 1
$$;

create function public.start_calendar_link(p_professional_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_state text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select barbershop_id into v_shop from public.professionals where id = p_professional_id;
  if v_shop is null or not private.is_my_professional(p_professional_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.calendar_connections (barbershop_id, professional_id, status, state_hash, state_expira_em)
  values (v_shop, p_professional_id, 'aguardando_consentimento', encode(sha256(convert_to(v_state, 'utf8')), 'hex'), now() + interval '10 minutes')
  on conflict (professional_id) do update
    set state_hash = excluded.state_hash, state_expira_em = excluded.state_expira_em,
        status = case when public.calendar_connections.status = 'ativo' then 'ativo' else 'aguardando_consentimento' end,
        atualizado_em = now();
  return v_state;
end;
$$;

create function public.complete_calendar_link(p_state text, p_calendar_id text, p_escopos text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.calendar_connections%rowtype;
  v_events constant text := 'https://www.googleapis.com/auth/calendar.events';
begin
  select * into c from public.calendar_connections
  where state_hash = encode(sha256(convert_to(coalesce(p_state, ''), 'utf8')), 'hex') and state_expira_em > now()
  for update;
  if c.id is null then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if p_escopos is null or not (v_events = any (p_escopos)) then
    raise exception 'scope_missing' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_escopos) s where s like 'https://www.googleapis.com/auth/calendar%' and s <> v_events) then
    raise exception 'scope_too_broad' using errcode = 'P0001';
  end if;
  if p_calendar_id is null or length(btrim(p_calendar_id)) not between 1 and 200 then
    raise exception 'invalid_calendar' using errcode = 'P0001';
  end if;
  update public.calendar_connections
  set status = 'ativo', calendar_id = btrim(p_calendar_id), escopos = p_escopos, consentido_em = now(),
      state_hash = null, state_expira_em = null, atualizado_em = now()
  where id = c.id;
  return c.id;
end;
$$;

create function public.store_calendar_tokens(p_professional_id uuid, p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.calendar_credentials (professional_id, refresh_token)
  values (p_professional_id, p_refresh_token)
  on conflict (professional_id) do update set refresh_token = excluded.refresh_token, atualizado_em = now();
end;
$$;

create function public.get_calendar_refresh_token(p_professional_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select refresh_token from public.calendar_credentials where professional_id = p_professional_id
$$;

create function public.unlink_calendar(p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  select barbershop_id into v_shop from public.professionals where id = p_professional_id;
  if v_shop is null or not (private.is_my_professional(p_professional_id) or private.has_role(v_shop, array['proprietario', 'gerente'])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.calendar_credentials where professional_id = p_professional_id;
  update public.calendar_event_links set status = 'desvinculado', atualizado_em = now()
  where status = 'sincronizado' and connection_id in (select id from public.calendar_connections where professional_id = p_professional_id);
  update public.calendar_connections
  set status = 'desvinculado', escopos = '{}', state_hash = null, state_expira_em = null, atualizado_em = now()
  where professional_id = p_professional_id;
  update public.outbox_events set status = 'cancelado', ultimo_erro = 'vinculo_removido', atualizado_em = now()
  where canal = 'google_calendar' and destino = p_professional_id::text and status in ('pendente', 'bloqueado');
end;
$$;

--------------------------------------------------------------
-- Sincronização (worker): destino atual, mapeamento e idempotência (F10-03)
--------------------------------------------------------------
create function public.get_calendar_target(p_booking_id uuid)
returns table (connection_id uuid, calendar_id text, professional_id uuid, external_event_id text, link_connection_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.calendar_id, b.professional_id, l.external_event_id, l.connection_id
  from public.bookings b
  left join public.calendar_connections c on c.professional_id = b.professional_id and c.status = 'ativo'
  left join public.calendar_event_links l on l.booking_id = b.id
  where b.id = p_booking_id
$$;

create function public.complete_calendar_sync(
  p_booking_id uuid, p_connection_id uuid, p_external_event_id text, p_etag text, p_deleted boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  select barbershop_id into v_shop from public.bookings where id = p_booking_id;
  if v_shop is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.calendar_event_links (booking_id, barbershop_id, connection_id, external_event_id, etag, status)
  values (p_booking_id, v_shop, p_connection_id, p_external_event_id, p_etag, case when p_deleted then 'removido' else 'sincronizado' end)
  on conflict (booking_id) do update
    set connection_id = excluded.connection_id,
        external_event_id = coalesce(excluded.external_event_id, public.calendar_event_links.external_event_id),
        etag = coalesce(excluded.etag, public.calendar_event_links.etag),
        status = excluded.status, ultimo_erro = null, atualizado_em = now();
end;
$$;

--------------------------------------------------------------
-- Outbox: eventos de calendário a partir dos eventos da reserva (substitui a função da 0006)
--------------------------------------------------------------
create or replace function private.enqueue_booking_event()
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
  v_payload jsonb;
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
  v_payload := jsonb_build_object(
    'booking_id', b.id, 'cliente', b.cliente_nome, 'servico', b.servico_nome, 'profissional', v_prof,
    'inicio', b.inicio, 'fim', b.fim, 'fuso', v_shop.fuso, 'barbearia', v_shop.nome, 'endereco', v_shop.endereco
  );

  if v_tipo = 'reserva_cancelada' then
    update public.outbox_events
    set status = 'cancelado', ultimo_erro = 'reserva_cancelada', atualizado_em = now()
    where booking_id = b.id and status in ('pendente', 'bloqueado')
      and (tipo like 'lembrete%' or tipo in ('reserva_criada', 'reserva_confirmada', 'reserva_reagendada', 'calendar_upsert'));
  end if;

  insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key, status, ultimo_erro)
  values (
    b.barbershop_id, b.id, b.customer_id, v_tipo, b.cliente_whatsapp, v_payload,
    b.id || ':' || v_tipo || ':' || new.id,
    case when v_consent then 'pendente' else 'cancelado' end,
    case when v_consent then null else 'sem_consentimento' end
  )
  on conflict (dedup_key) do nothing;

  -- agenda do profissional no Google (só se ele vinculou e consentiu)
  if v_tipo in ('reserva_criada', 'reserva_reagendada', 'reserva_cancelada')
     and exists (select 1 from public.calendar_connections where professional_id = b.professional_id and status = 'ativo') then
    insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, canal, destino, payload, dedup_key)
    values (
      b.barbershop_id, b.id, b.customer_id,
      case when v_tipo = 'reserva_cancelada' then 'calendar_delete' else 'calendar_upsert' end,
      'google_calendar', b.professional_id::text, v_payload, b.id || ':calendar:' || new.id
    )
    on conflict (dedup_key) do nothing;
  end if;
  return new;
end;
$$;

-- claim_outbox da 0006, agora exigindo a integração do CANAL do evento (whatsapp ou google_calendar)
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

revoke all on function
  public.complete_calendar_link(text, text, text[]),
  public.store_calendar_tokens(uuid, text),
  public.get_calendar_refresh_token(uuid),
  public.get_calendar_target(uuid),
  public.complete_calendar_sync(uuid, uuid, text, text, boolean)
from public, anon, authenticated;
grant execute on function
  public.complete_calendar_link(text, text, text[]),
  public.store_calendar_tokens(uuid, text),
  public.get_calendar_refresh_token(uuid),
  public.get_calendar_target(uuid),
  public.complete_calendar_sync(uuid, uuid, text, text, boolean)
to service_role;
revoke all on function public.start_calendar_link(uuid), public.unlink_calendar(uuid), public.my_professional(uuid) from public, anon;
grant execute on function public.start_calendar_link(uuid), public.unlink_calendar(uuid), public.my_professional(uuid) to authenticated;
