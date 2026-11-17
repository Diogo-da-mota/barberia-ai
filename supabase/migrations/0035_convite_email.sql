-- Barberia AI — migração 0035: aceite do convite com o motivo certo quando a conta não é a do convite.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0001 e 0033. Nenhum dado muda; convites e usuários ficam.
--
-- A validação continua no servidor e antes de qualquer gravação (membro, card ou aceite): token existente (só o hash é
-- guardado), não usado, dentro dos 7 dias; e-mail da conta CONFIRMADO no Supabase Auth (Google ou e-mail/senha) e igual
-- ao do convite, sem diferença de maiúsculas ou espaços. Barbearia e papel vêm só do convite. O que muda: em vez de um
-- erro único, conta não confirmada recebe 'email_not_confirmed' e conta de outro e-mail recebe 'invite_wrong_email'
-- (só depois de o token se provar válido; quem não tem o token continua recebendo 'invalid_invite'). O resto é igual à 0033.

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_confirmed boolean;
  v_invite public.invites%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;

  if v_invite.id is null or v_invite.aceito_em is not null or v_invite.expires_at <= now() then
    raise exception 'invalid_invite' using errcode = '22023';
  end if;

  select lower(btrim(email)), email_confirmed_at is not null into v_email, v_confirmed
  from auth.users
  where id = v_user;

  if not coalesce(v_confirmed, false) then
    raise exception 'email_not_confirmed' using errcode = '42501';
  end if;
  if v_email is distinct from lower(btrim(v_invite.email)) then
    raise exception 'invite_wrong_email' using errcode = '42501';
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
