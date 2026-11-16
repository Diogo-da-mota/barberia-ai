-- Barberia AI — migração 0025: instruções da Lara por barbearia (Configurações › Assistente).
-- Um assunto só: texto livre da gestão que a Edge Function `assistant` acrescenta às regras fixas da Lara
-- nas conversas daquela barbearia. Leitura: membros da barbearia (RLS de barbershops, 0001; visitante não lê).
-- Escrita: só save_assistant_instructions (proprietário ou gerente). Começa vazio.
alter table public.barbershops
  add column if not exists assistente_instrucoes text not null default ''
  check (length(assistente_instrucoes) <= 2000);

comment on column public.barbershops.assistente_instrucoes is 'Instruções personalizadas da Lara (assistente do painel), até 2000 caracteres.';

create or replace function public.save_assistant_instructions(p_barbershop_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
begin
  if not private.has_role(p_barbershop_id, array['proprietario', 'gerente']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_texto) > 2000 then
    raise exception 'invalid_instructions' using errcode = 'P0001';
  end if;
  update public.barbershops set assistente_instrucoes = v_texto where id = p_barbershop_id;
end;
$$;

revoke all on function public.save_assistant_instructions(uuid, text) from public, anon;
grant execute on function public.save_assistant_instructions(uuid, text) to authenticated;
