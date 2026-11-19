-- Barberia AI — migração 0037: o convite só liga a conta a um cadastro manual pelo e-mail confirmado, nunca pelo nome.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0033 e 0035. Testada em supabase/tests/convite-equipe.test.ts.
-- Nenhum dado muda: reservas, comissões, repasses, permissões e vínculos já feitos ficam como estão (só a função é trocada).
--
-- Antes (0033): sem e-mail igual, o aceite ligava a conta ao card manual SEM e-mail de MESMO NOME. O nome vem de
-- profiles.nome, que o próprio usuário escolhe (cadastro, Google ou edição do perfil): um barbeiro convidado podia trocar o
-- nome e assumir o card de outro profissional (reservas com WhatsApp dos clientes, comissões e repasses), e um homônimo
-- caía no card errado sem má-fé. Agora o card manual (sem conta) só é ligado quando o e-mail que a gestão gravou nele é
-- igual ao e-mail CONFIRMADO da conta no Supabase Auth (sem diferença de maiúsculas ou espaços). Sem esse casamento, a
-- conta ganha um card próprio (nome repetido recebe o início do e-mail, como antes) e nenhum cadastro existente é
-- assumido. Para ligar um cadastro manual ao convidado, a gestão grava no card o mesmo e-mail do convite antes do aceite.
-- O resto é igual à 0033 (card já ligado à conta é devolvido; acima do limite do plano o card entra inativo).

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
  v_confirmado text;
begin
  select id into v_id from public.professionals where barbershop_id = p_barbershop_id and profile_id = p_profile_id;
  if v_id is not null then
    return v_id;
  end if;

  select left(btrim(p.nome), 80), lower(coalesce(u.email, p.email)),
         case when u.email_confirmed_at is not null then lower(btrim(u.email)) end
  into v_nome, v_email, v_confirmado
  from public.profiles p left join auth.users u on u.id = p.id
  where p.id = p_profile_id;

  -- Cadastro manual da mesma pessoa (ainda sem conta): só pelo e-mail gravado pela gestão no card, igual ao e-mail
  -- confirmado da conta. O nome nunca identifica a pessoa.
  if v_confirmado is not null then
    select id into v_id from public.professionals
    where barbershop_id = p_barbershop_id and profile_id is null and lower(btrim(email)) = v_confirmado
    order by criado_em
    limit 1
    for update;
  end if;

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
