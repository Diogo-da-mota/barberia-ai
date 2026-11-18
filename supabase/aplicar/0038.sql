-- Cópia de supabase/migrations/0038_desligamento_equipe.sql para o banco remoto. Troca is_my_professional e my_professional e cria o gatilho de desligamento. Nenhum dado muda.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0038.sql
-- Conferir depois, só leitura: select count(*) from pg_trigger where tgname = 'professionals_revoke_access'; (esperado: 1)
begin;
-- Barberia AI — migração 0038: barbeiro desligado perde o acesso (card desativado, excluído ou sem vínculo atual).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0004, 0005 e 0009. Testada em supabase/tests/desligamento-equipe.test.ts.
-- Nenhum dado existente muda: reservas, comissões, repasses e histórico ficam; só a autorização e a limpeza no desligamento.
--
-- Antes: private.is_my_professional e my_professional autorizavam só por professionals.profile_id = auth.uid(). Desativar o
-- card (Equipe › Profissional ativo) não cortava nada, e excluir o card deixava o vínculo 'barbeiro' (memberships) para
-- sempre: o ex-barbeiro seguia lendo nome e WhatsApp dos clientes, comissões e repasses do card, marcando presença
-- (concluido/nao_compareceu) e ligando o Google Agenda. Agora:
--   1. is_my_professional e my_professional exigem o card ATIVO e um vínculo de equipe atual (memberships) na barbearia do card.
--   2. Excluir o card de um barbeiro remove o vínculo 'barbeiro' da conta nessa barbearia (proprietário e gerente nunca são
--      removidos). Card com histórico continua protegido pelas FKs (on delete restrict): a gestão o desativa.
--   3. Desativar o card encerra o Google Agenda ligado a ele (mesma limpeza de unlink_calendar). Reativar devolve o acesso à
--      agenda e ao financeiro do card; o Google Agenda precisa ser ligado de novo pelo próprio barbeiro.
-- Gestão (proprietário/gerente) continua autorizada por private.has_role, sem mudança.

create or replace function private.is_my_professional(p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.professionals p
    join public.memberships m on m.barbershop_id = p.barbershop_id and m.profile_id = p.profile_id
    where p.id = p_professional_id and p.profile_id = auth.uid() and p.ativo
      and m.papel in ('proprietario', 'gerente', 'barbeiro')
  )
$$;

create or replace function public.my_professional(p_barbershop_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.professionals p
  join public.memberships m on m.barbershop_id = p.barbershop_id and m.profile_id = p.profile_id
  where p.barbershop_id = p_barbershop_id and p.profile_id = auth.uid() and p.ativo
    and m.papel in ('proprietario', 'gerente', 'barbeiro')
  limit 1
$$;

create function private.revoke_team_professional()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.profile_id is not null then
      delete from public.memberships
      where barbershop_id = old.barbershop_id and profile_id = old.profile_id and papel = 'barbeiro';
      if found and exists (select 1 from public.barbershops where id = old.barbershop_id) then
        insert into public.audit_logs (barbershop_id, profile_id, acao, detalhes)
        values (old.barbershop_id, auth.uid(), 'member.removed', jsonb_build_object('profile_id', old.profile_id, 'professional_id', old.id, 'origem', 'card_excluido'));
      end if;
    end if;
    return old;
  end if;

  if old.ativo and not new.ativo then
    delete from public.calendar_credentials where professional_id = new.id;
    update public.calendar_event_links set status = 'desvinculado', atualizado_em = now()
    where status = 'sincronizado' and connection_id in (select id from public.calendar_connections where professional_id = new.id);
    update public.calendar_connections
    set status = 'desvinculado', escopos = '{}', state_hash = null, state_expira_em = null, atualizado_em = now()
    where professional_id = new.id and status <> 'desvinculado';
    update public.outbox_events set status = 'cancelado', ultimo_erro = 'vinculo_removido', atualizado_em = now()
    where canal = 'google_calendar' and destino = new.id::text and status in ('pendente', 'bloqueado');
  end if;
  return new;
end;
$$;

revoke all on function private.revoke_team_professional() from public, anon, authenticated;

create trigger professionals_revoke_access
  after delete or update of ativo on public.professionals
  for each row execute function private.revoke_team_professional();
commit;
