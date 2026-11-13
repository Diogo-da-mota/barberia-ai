-- Cópia de supabase/migrations/0022_agendamento_manual.sql para o banco remoto (depois da 0021). Pode ser reaplicado sem efeito.
-- Aplicar só com autorização, no Terminal:
--   supabase db query --remote --yes -f supabase/aplicar/0022.sql
-- Conferir depois, só leitura (esperado: true | true | true | true):
--   supabase db query --remote --read-only "select (select is_nullable = 'YES' from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='customer_id') as sem_conta, exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='whatsapp') as whatsapp_perfil, to_regprocedure('public.create_manual_booking(uuid, uuid, uuid, timestamptz, text, text, boolean, text, text)') is not null as manual, to_regprocedure('public.link_my_bookings()') is not null as vinculo"
begin;

-- Barberia AI — migração 0022: agendamento manual pela barbearia e vínculo da reserva com a conta do cliente
--
-- 1) Agendamento manual: a gestão (proprietário ou gerente) agenda pelo painel para qualquer cliente, com nome, WhatsApp e,
--    opcionalmente, e-mail. A reserva NÃO fica na conta do funcionário: nasce sem cliente (customer_id nulo). Quem criou fica
--    no histórico (booking_events.actor_id). Barbeiro não ganha permissão nova: o banco recusa quem não é gestão.
--    Reaproveita horários (private.slots), a trava de horário (occupancies), avisos (booking_events), comissão e pagamentos.
-- 2) Cadastro com WhatsApp: profiles.whatsapp (só dígitos). O cadastro por e-mail manda o número no user_metadata e o
--    gatilho de nova conta copia para o perfil; quem entra com Google preenche na primeira reserva (fill_my_whatsapp).
-- 3) Vínculo: link_my_bookings() traz para a conta do cliente as reservas manuais SEM dono que tenham o MESMO e-mail
--    (confirmado, comparado em minúsculas) E o MESMO WhatsApp (mesma chave br_phone_key, qualquer formato). E-mail não
--    confirmado, WhatsApp diferente ou reserva que já tem dono não são vinculados. Só troca o customer_id: histórico,
--    comissões e pagamentos continuam ligados à mesma reserva. Repetir não faz nada (só pega customer_id nulo).
--
-- Efeitos já tratados pelas funções existentes (conferido): sem customer_id, a reserva não entra em "Minhas reservas" de
-- ninguém, não consome limites do cliente, fica fora do "Retorno do cliente" e o "PARAR" ignora o consentimento de marketing.
-- Nada é apagado; reservas e perfis existentes continuam iguais (as colunas novas começam vazias).
-- Volta (só se nenhuma reserva manual existir): reaplicar handle_new_user da 0001; drop das funções create_manual_booking,
--   link_my_bookings e fill_my_whatsapp; drop dos índices idx_bookings_manual_idem e idx_bookings_manual_email; drop das
--   colunas bookings.cliente_email e profiles.whatsapp; alter table public.bookings alter column customer_id set not null.

--------------------------------------------------------------
-- Colunas e índices
--------------------------------------------------------------
alter table public.bookings alter column customer_id drop not null;

alter table public.bookings add column if not exists cliente_email text
  check (cliente_email is null or (cliente_email = lower(cliente_email) and length(cliente_email) <= 254 and cliente_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));

alter table public.profiles add column if not exists whatsapp text
  check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$');

-- Idempotência da reserva manual (o unique (customer_id, idempotency_key) não vale com cliente nulo)
create unique index if not exists idx_bookings_manual_idem
  on public.bookings (barbershop_id, idempotency_key)
  where customer_id is null and idempotency_key is not null;

-- Busca das reservas manuais ainda sem dono pelo e-mail
create index if not exists idx_bookings_manual_email
  on public.bookings (cliente_email)
  where customer_id is null and cliente_email is not null;

--------------------------------------------------------------
-- Nova conta: igual à 0001 + WhatsApp do cadastro (só se for um número válido)
--------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_whats text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'whatsapp', ''), '\D', '', 'g');
begin
  insert into public.profiles (id, nome, email, whatsapp)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuário'
    ), 120),
    new.email,
    case when v_whats ~ '^[0-9]{10,13}$' then v_whats end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

--------------------------------------------------------------
-- WhatsApp da conta que ainda não tem (ex.: entrou com Google): preenche uma vez, nunca troca o que já existe
--------------------------------------------------------------
create or replace function public.fill_my_whatsapp(p_whatsapp text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_whats text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_whats !~ '^[0-9]{10,13}$' then
    raise exception 'invalid_contact' using errcode = '22023';
  end if;
  update public.profiles set whatsapp = v_whats where id = auth.uid() and whatsapp is null;
end;
$$;

--------------------------------------------------------------
-- Agendamento manual (gestão), cliente sem conta
--------------------------------------------------------------
create or replace function public.create_manual_booking(
  p_barbershop_id uuid,
  p_service_id uuid,
  p_professional_id uuid,
  p_inicio timestamptz,
  p_nome text,
  p_whatsapp text,
  p_consent_lembretes boolean,
  p_idempotency_key text,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tz text;
  v_svc public.services%rowtype;
  v_whats text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_occ uuid;
  v_fim timestamptz;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_nome, ''))) not between 1 and 120 or length(v_whats) not between 10 and 13
     or (v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then
    raise exception 'invalid_contact' using errcode = '22023';
  end if;
  if p_professional_id is null then
    raise exception 'invalid_professional' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.bookings
    where barbershop_id = p_barbershop_id and customer_id is null and idempotency_key = p_idempotency_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  select * into v_svc from public.services where id = p_service_id and barbershop_id = p_barbershop_id and ativo;
  select fuso into v_tz from public.barbershops where id = p_barbershop_id and status = 'ativo';
  if v_svc.id is null or v_tz is null then
    raise exception 'invalid_service' using errcode = '22023';
  end if;

  -- Mesmas regras da reserva pública: o horário precisa estar livre para este barbeiro e este serviço
  if not exists (
    select 1 from private.slots(p_barbershop_id, p_service_id, p_professional_id, (p_inicio at time zone v_tz)::date, v_svc.duracao_min) s
    where s.slot_inicio = p_inicio and s.prof_id = p_professional_id
  ) then
    raise exception 'slot_taken' using errcode = '23P01';
  end if;

  v_fim := p_inicio + make_interval(mins => v_svc.duracao_min);
  begin
    insert into public.occupancies (barbershop_id, professional_id, kind, periodo, criado_por)
    values (p_barbershop_id, p_professional_id, 'booking', tstzrange(p_inicio, v_fim, '[)'), v_user)
    returning id into v_occ;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = '23P01';
  end;

  insert into public.bookings (barbershop_id, professional_id, customer_id, service_id, servico_nome, preco_centavos,
    duracao_min, inicio, fim, cliente_nome, cliente_whatsapp, cliente_email, consent_lembretes, consent_marketing, idempotency_key, occupancy_id)
  values (p_barbershop_id, p_professional_id, null, v_svc.id, v_svc.nome, v_svc.preco_centavos,
    v_svc.duracao_min, p_inicio, v_fim, btrim(p_nome), v_whats, v_email, coalesce(p_consent_lembretes, false),
    false, p_idempotency_key, v_occ)
  returning id into v_id;

  insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
  values (v_id, p_barbershop_id, v_user, 'created', jsonb_build_object('professional_id', p_professional_id, 'inicio', p_inicio, 'origem', 'manual'));

  return v_id;
end;
$$;

--------------------------------------------------------------
-- Vínculo: reservas manuais sem dono com o mesmo e-mail confirmado E o mesmo WhatsApp passam para a conta
--------------------------------------------------------------
create or replace function public.link_my_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_fone text;
  v_total integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- e-mail só conta depois de confirmado (prova de que a conta é dona do e-mail)
  select nullif(lower(btrim(coalesce(u.email, ''))), '') into v_email
  from auth.users u where u.id = v_user and u.email_confirmed_at is not null;
  -- o WhatsApp da conta precisa bater com o da reserva: e-mail digitado errado pela barbearia não leva a reserva a um estranho
  select private.br_phone_key(p.whatsapp) into v_fone from public.profiles p where p.id = v_user;
  if v_email is null or v_fone is null then
    return 0;
  end if;

  with alvo as (
    update public.bookings b
    set customer_id = v_user
    where b.customer_id is null and b.cliente_email = v_email and private.br_phone_key(b.cliente_whatsapp) = v_fone
    returning b.id, b.barbershop_id
  ), vinculo as (
    insert into public.memberships (barbershop_id, profile_id, papel)
    select distinct a.barbershop_id, v_user, 'cliente' from alvo a
    on conflict (barbershop_id, profile_id) do nothing
  ), historico as (
    insert into public.booking_events (booking_id, barbershop_id, actor_id, tipo, detalhes)
    select a.id, a.barbershop_id, v_user, 'linked', jsonb_build_object('origem', 'email_confirmado') from alvo a
  )
  select count(*) into v_total from alvo;
  return v_total;
end;
$$;

--------------------------------------------------------------
-- Permissões
--------------------------------------------------------------
revoke all on function
  public.create_manual_booking(uuid, uuid, uuid, timestamptz, text, text, boolean, text, text),
  public.link_my_bookings(),
  public.fill_my_whatsapp(text)
from public, anon;
grant execute on function
  public.create_manual_booking(uuid, uuid, uuid, timestamptz, text, text, boolean, text, text),
  public.link_my_bookings(),
  public.fill_my_whatsapp(text)
to authenticated;

commit;
