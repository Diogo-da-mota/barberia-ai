-- Diferença para o REMOTO (migration 0006 já aplicada): apagar mensagem pelo painel. Só cria uma função; não altera dados.
-- Rodar com autorização: supabase db query --remote --yes -f supabase/aplicar/diferenca-lixeira-mensagem.sql
begin;

create or replace function public.delete_outbox_event(p_id uuid)
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

revoke all on function public.delete_outbox_event(uuid) from public, anon;
grant execute on function public.delete_outbox_event(uuid) to authenticated;

commit;
