-- Cópia de supabase/migrations/0043_agenda_desvincular_conta.sql para o banco remoto. Troca revoke_team_professional e recria o gatilho professionals_revoke_access (ativo e profile_id). Aplicar DEPOIS da 0038.
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0043.sql
-- Conferir depois, só leitura: select count(*) from pg_trigger where tgname = 'professionals_revoke_access'; (esperado: 1)
begin;
-- Barberia AI — migração 0043: tirar a conta do card (ou trocar a conta) encerra o Google Agenda ligado a ele.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0009 e 0038. Testada em supabase/tests/desligamento-equipe.test.ts.
-- Nenhum dado existente muda; o Google Agenda continua desligado no produto (esta proteção vale quando for ativado).
--
-- Antes: a conexão do Google Agenda e o refresh token são do CARD (calendar_connections/calendar_credentials por
-- professional_id). A 0038 já encerra a conexão quando o card é desativado e o card excluído leva tudo junto (cascade), mas
-- link_professional(card, null), link_professional(card, outra conta) e a exclusão do perfil (profile_id on delete set null)
-- só trocavam profile_id: a conexão seguia 'ativo' com o token da conta anterior, e as reservas novas do card iriam para a
-- agenda dela. Agora o mesmo gatilho da 0038 faz a limpeza de unlink_calendar também quando a conta ligada ao card muda,
-- inclusive quando um card já sem conta (com conexão antiga deixada pelo defeito) é ligado a uma conta nova.

create or replace function private.revoke_team_professional()
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

  if (old.ativo and not new.ativo) or old.profile_id is distinct from new.profile_id then
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

drop trigger professionals_revoke_access on public.professionals;
create trigger professionals_revoke_access
  after delete or update of ativo, profile_id on public.professionals
  for each row execute function private.revoke_team_professional();
commit;
