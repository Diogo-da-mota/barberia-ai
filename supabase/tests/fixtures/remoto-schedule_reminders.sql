-- Retrato do schedule_reminders em produção (hbkbdqctelembzqiptpi), lido em 2026-11-07 com pg_get_functiondef, somente leitura.
-- É um rascunho anterior da 0017: janela "entre a antecedência e 15 min antes" (com 15 min nunca gera) e o tipo dentro da chave
-- (trocar a antecedência gera outro lembrete). Usado por diferenca-lembretes.test.ts. Não aplicar em nenhum banco real.
CREATE OR REPLACE FUNCTION public.schedule_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_n integer := 0;
  v_i integer;
  r record;
begin
  for r in
    select b.*, p.nome as prof_nome, s.fuso, s.nome as shop_nome, s.endereco, s.reminder_config
    from public.bookings b
    join public.professionals p on p.id = b.professional_id
    join public.barbershops s on s.id = b.barbershop_id
    where b.status = 'confirmado'
      and b.consent_lembretes
      and b.inicio > now() + interval '15 minutes'
      and (s.reminder_config ->> 'auto_reminder')::boolean = true
  loop
    -- Calcula o lead time em minutos da configuração
    declare
      lead_min int := (r.reminder_config ->> 'lead_time_minutes')::int;
      lead_interval interval := make_interval(mins => lead_min);
      reminder_type text := 'lembrete_' || lead_min || 'min';
      reminder_label text := case
        when lead_min = 15 then '15min'
        when lead_min = 30 then '30min'
        when lead_min = 60 then '1h'
        when lead_min = 120 then '2h'
        else lead_min || 'min'
      end;
      dedup_suffix text := r.id || ':' || reminder_type || ':' || extract(epoch from r.inicio)::bigint;
    begin
      -- Só envia se estiver na janela: entre lead_time antes e 15 min antes
      if r.inicio - lead_interval <= now() and r.inicio > now() + interval '15 minutes' then
        insert into public.outbox_events (barbershop_id, booking_id, customer_id, tipo, destino, payload, dedup_key)
        values (
          r.barbershop_id, r.id, r.customer_id, reminder_type, r.cliente_whatsapp,
          jsonb_build_object(
            'booking_id', r.id, 'cliente', r.cliente_nome, 'servico', r.servico_nome,
            'profissional', r.prof_nome, 'inicio', r.inicio, 'fim', r.fim,
            'fuso', r.fuso, 'barbearia', r.shop_nome, 'endereco', r.endereco,
            'lead_time_minutes', lead_min, 'reminder_label', reminder_label
          ),
          dedup_suffix
        )
        on conflict (dedup_key) do nothing;
        get diagnostics v_i = row_count;
        v_n := v_n + v_i;
      end if;
    end;
  end loop;
  return v_n;
end;
$function$;
