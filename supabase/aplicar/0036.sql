-- Cópia de supabase/migrations/0036_convite_renovar.sql para o banco remoto (depois da 0035). Cria renew_invite e troca
-- create_invite (renova o pendente do mesmo e-mail e papel em vez de duplicar). Nenhum convite existente muda.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0036.sql
-- Conferir depois, só leitura (esperado: 1): select count(*) from pg_proc where proname = 'renew_invite';
begin;
-- Barberia AI — migração 0036: renovar o link de um convite pendente e não duplicar convites.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0001 (e do aceite da 0035). Nenhum dado existente muda.
--
-- O token do convite é guardado só como hash (sha256): não dá para mostrar de novo um link já gerado. Em vez de
-- enfraquecer isso, a gestão RENOVA o link no mesmo convite: novo token, o anterior deixa de valer na hora, prazo de 7
-- dias a partir da renovação. Só convite pendente e dentro do prazo (aceito ou expirado: 'invite_closed'). Mesma
-- permissão de create_invite (proprietário; gerente só convite de barbeiro). O aceite continua exigindo o e-mail
-- confirmado do convite (0035). create_invite passa a reaproveitar o convite pendente do mesmo e-mail e papel na
-- barbearia (renova o link) em vez de criar outro. O token nunca vai para registro nenhum.

create function private.rotate_invite_token(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  update public.invites
  set token_hash = encode(sha256(convert_to(v_token, 'utf8')), 'hex'), expires_at = now() + interval '7 days'
  where id = p_invite_id;
  return v_token;
end;
$$;

revoke all on function private.rotate_invite_token(uuid) from public, anon, authenticated;

create function public.renew_invite(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_invite from public.invites where id = p_invite_id for update;
  if v_invite.id is null or not (
    private.has_role(v_invite.barbershop_id, array['proprietario'])
    or (v_invite.papel = 'barbeiro' and private.has_role(v_invite.barbershop_id, array['gerente']))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_invite.aceito_em is not null or v_invite.expires_at <= now() then
    raise exception 'invite_closed' using errcode = '22023';
  end if;

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (v_invite.barbershop_id, auth.uid(), 'invite.renewed', jsonb_build_object('email', v_invite.email, 'papel', v_invite.papel));
  return private.rotate_invite_token(v_invite.id);
end;
$$;

revoke all on function public.renew_invite(uuid) from public, anon;
grant execute on function public.renew_invite(uuid) to authenticated;

-- Igual à 0001, mais: convite pendente e válido do mesmo e-mail e papel na barbearia é renovado, não duplicado.
create or replace function public.create_invite(p_barbershop_id uuid, p_email text, p_papel text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_token text;
  v_pending uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_papel not in ('gerente', 'barbeiro') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if not (
    private.has_role(p_barbershop_id, array['proprietario'])
    or (p_papel = 'barbeiro' and private.has_role(p_barbershop_id, array['gerente']))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id into v_pending
  from public.invites
  where barbershop_id = p_barbershop_id and lower(btrim(email)) = v_email and papel = p_papel
    and aceito_em is null and expires_at > now()
  order by criado_em desc
  limit 1
  for update;

  if v_pending is not null then
    insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
    values (p_barbershop_id, v_user, 'invite.renewed', jsonb_build_object('email', v_email, 'papel', p_papel));
    return private.rotate_invite_token(v_pending);
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.invites (barbershop_id, email, papel, token_hash, expires_at)
  values (p_barbershop_id, v_email, p_papel, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), now() + interval '7 days');

  insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
  values (p_barbershop_id, v_user, 'invite.created', jsonb_build_object('email', v_email, 'papel', p_papel));

  return v_token;
end;
$$;
commit;
