-- Cópia de supabase/migrations/0047_agenda_vinculo_dono.sql para o banco remoto. Cria calendar_state_owner (service_role). Junto: publicar google-calendar-oauth e o front (só quando o Google Agenda for ativado).
--   supabase db query --remote=hbkbdqctelembzqiptpi --yes -f supabase/aplicar/0047.sql
-- Conferir depois, só leitura: select has_function_privilege('authenticated', 'public.calendar_state_owner(text)', 'execute'); (esperado: false)
begin;
-- Barberia AI — migração 0047: o vínculo do Google Agenda só é concluído pela conta dona do profissional que o iniciou.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende de 0009 e 0038. Testada em supabase/tests/agenda-oauth.test.ts.
-- Nenhum dado muda; o Google Agenda continua desligado no produto (esta proteção vale quando for ativado).
--
-- Antes: o link de início (…/google-calendar-oauth?state=) aberto em QUALQUER navegador recebia o cookie PKCE e, depois do
-- consentimento no Google, complete_calendar_link ligava a conta Google de quem consentiu ao profissional dono do state
-- (o barbeiro que mandou o link). Agora a função de servidor só troca o código do Google num pedido autenticado do app
-- (POST com a sessão do painel) e, antes disso, confere com calendar_state_owner que o state válido pertence ao profissional
-- ATIVO, com vínculo de equipe, da própria conta que está concluindo.

create function public.calendar_state_owner(p_state text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.profile_id
  from public.calendar_connections c
  join public.professionals p on p.id = c.professional_id and p.ativo
  join public.memberships m on m.barbershop_id = p.barbershop_id and m.profile_id = p.profile_id
    and m.papel in ('proprietario', 'gerente', 'barbeiro')
  where c.state_hash = encode(sha256(convert_to(coalesce(p_state, ''), 'utf8')), 'hex') and c.state_expira_em > now()
$$;

revoke all on function public.calendar_state_owner(text) from public, anon, authenticated;
grant execute on function public.calendar_state_owner(text) to service_role;
commit;
