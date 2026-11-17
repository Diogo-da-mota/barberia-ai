-- Cópia de supabase/migrations/0033_convite_equipe.sql para o banco remoto (depois da 0032). Aplicar uma vez (reaplicar não duplica).
-- Pelo plugin do Supabase (execute_sql) ou: supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0033.sql
-- Conferir depois, só leitura (esperado: 0 barbeiros sem card):
--   select count(*) from memberships m where m.papel = 'barbeiro' and not exists (select 1 from professionals p where p.barbershop_id = m.barbershop_id and p.profile_id = m.profile_id);
begin;
-- Barberia AI — migração 0033: convite aceito aparece na Equipe.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0001, 0002 e 0004. Testada em supabase/tests/convite-equipe.test.ts.
--
-- Antes: accept_invite só criava o vínculo (memberships); a Equipe lista professionals, então o barbeiro convidado
-- não aparecia. Agora o barbeiro que aceita vira profissional ligado à conta (profile_id): liga o cadastro manual
-- correspondente (mesmo e-mail; ou mesmo nome sem e-mail) ou cria um card novo. Nunca duplica nem troca o vínculo de
-- outra conta. Acima do limite do plano o card entra inativo (a gestão ativa depois). Gerente continua só como membro
-- (papel gerente). Reservas, serviços e horários não mudam.

create or replace function private.ensure_team_professional(p_barbershop_id uuid, p_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text;
  v_email text;
begin
  select id into v_id from public.professionals where barbershop_id = p_barbershop_id and profile_id = p_profile_id;
  if v_id is not null then
    return v_id;
  end if;

  select left(btrim(p.nome), 80), lower(coalesce(u.email, p.email)) into v_nome, v_email
  from public.profiles p left join auth.users u on u.id = p.id
  where p.id = p_profile_id;

  -- Cadastro manual da mesma pessoa (ainda sem conta): mesmo e-mail; senão, mesmo nome e sem e-mail cadastrado.
  select id into v_id from public.professionals
  where barbershop_id = p_barbershop_id and profile_id is null
    and (lower(email) = v_email or (email is null and lower(btrim(nome)) = lower(v_nome)))
  order by (lower(email) = v_email) desc nulls last, criado_em
  limit 1
  for update;

  if v_id is not null then
    update public.professionals set profile_id = p_profile_id where id = v_id;
  else
    -- O nome é único na barbearia: se outra pessoa já usa o nome, acrescenta o início do e-mail.
    if exists (select 1 from public.professionals where barbershop_id = p_barbershop_id and lower(btrim(nome)) = lower(v_nome)) then
      v_nome := left(v_nome, 60) || ' · ' || left(split_part(v_email, '@', 1), 18);
    end if;
    begin
      insert into public.professionals (barbershop_id, nome, email, profile_id)
      values (p_barbershop_id, v_nome, v_email, p_profile_id)
      returning id into v_id;
    exception when sqlstate 'P0001' then
      if sqlerrm not in ('plan_limit', 'subscription_inactive') then
        raise;
      end if;
      -- Plano no limite (0008): o card entra inativo — aparece na Equipe e a gestão ativa quando o plano permitir.
      insert into public.professionals (barbershop_id, nome, email, profile_id, ativo)
      values (p_barbershop_id, v_nome, v_email, p_profile_id, false)
      returning id into v_id;
    end;
  end if;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (p_barbershop_id, p_profile_id, 'professional.linked', jsonb_build_object('professional_id', v_id, 'profile_id', p_profile_id, 'origem', 'convite'));
  return v_id;
end;
$$;

revoke all on function private.ensure_team_professional(uuid, uuid) from public, anon, authenticated;

-- Igual à 0001, mais o card do barbeiro (última instrução antes do retorno).
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_invite public.invites%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;

  select lower(email) into v_email
  from auth.users
  where id = v_user and email_confirmed_at is not null;

  if v_invite.id is null
     or v_invite.aceito_em is not null
     or v_invite.expires_at <= now()
     or v_email is distinct from lower(v_invite.email) then
    raise exception 'invalid_invite' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.memberships where barbershop_id = v_invite.barbershop_id and profile_id = v_user
  ) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.memberships (barbershop_id, profile_id, papel)
  values (v_invite.barbershop_id, v_user, v_invite.papel);

  update public.invites set aceito_em = now() where id = v_invite.id;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (v_invite.barbershop_id, v_user, 'invite.accepted', jsonb_build_object('papel', v_invite.papel));

  if v_invite.papel = 'barbeiro' then
    perform private.ensure_team_professional(v_invite.barbershop_id, v_user);
  end if;

  return v_invite.barbershop_id;
end;
$$;

-- Barbeiros que aceitaram o convite antes desta correção (vínculo sem card). Reaplicar não duplica.
select private.ensure_team_professional(m.barbershop_id, m.profile_id)
from public.memberships m
where m.papel = 'barbeiro'
  and not exists (select 1 from public.professionals p where p.barbershop_id = m.barbershop_id and p.profile_id = m.profile_id);

commit;
