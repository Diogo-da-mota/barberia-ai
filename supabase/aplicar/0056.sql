-- Cópia de supabase/migrations/0056_excluir_conta.sql para o banco remoto. Exclusão da própria conta (LGPD): delete_my_account().
--   supabase db query --remote --yes -f supabase/aplicar/0056.sql   (depois publicar o front)
-- Conferir depois, só leitura: select has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE'); (esperado: false)
begin;
-- Barberia AI — migração 0056: exclusão da própria conta (LGPD).
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Testada em supabase/tests/excluir-conta.test.ts. Nenhum dado muda ao aplicar.
--
-- public.delete_my_account(): a pessoa logada apaga a própria conta (menu da conta na área do cliente).
--   - Dono de barbearia não exclui por aqui ('owner_cannot_delete'): a conta segura a barbearia (barbershops.owner_id).
--   - Com reserva futura pendente/confirmada não exclui ('has_upcoming_bookings'): cancelar antes, para a barbearia saber.
--   - Avisos de WhatsApp da pessoa: os que iam sair são cancelados; telefone e texto são apagados de todos.
--   - Reservas antigas ficam para o histórico e o financeiro da barbearia, sem dono e sem nome, WhatsApp e e-mail
--     ('Cliente removido'); por isso link_my_bookings nunca as devolve a uma conta nova.
--   - A conta (auth.users) é apagada: perfil, vínculos, consentimentos e sessões saem em cascata; card de profissional e
--     registros de autoria ficam sem a conta (on delete set null).

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.barbershops b where b.owner_id = v_uid) then
    raise exception 'owner_cannot_delete' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bookings b where b.customer_id = v_uid and b.status in ('pendente', 'confirmado') and b.fim > now()) then
    raise exception 'has_upcoming_bookings' using errcode = 'P0001';
  end if;

  update public.outbox_events o
  set status = case when o.status in ('pendente', 'enviando') then 'cancelado' else o.status end,
      destino = 'removido', payload = '{}'::jsonb, atualizado_em = now()
  where o.customer_id = v_uid or o.booking_id in (select b.id from public.bookings b where b.customer_id = v_uid);

  update public.bookings b
  set customer_id = null, cliente_nome = 'Cliente removido', cliente_whatsapp = '', cliente_email = null
  where b.customer_id = v_uid;

  delete from auth.users u where u.id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
commit;
