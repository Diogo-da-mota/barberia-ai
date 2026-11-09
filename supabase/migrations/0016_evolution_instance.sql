-- Barberia AI — migração 0016: instância Evolution API por barbearia
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA (PLANO_IMPLEMENTACAO.md, Segurança.md).
-- Não depende da migration 0015 (tabelas/colunas independentes).
-- Adiciona colunas para identificar e cachear a instância Evolution vinculada à barbearia.

--------------------------------------------------------------
-- Colunas para Evolution API
--------------------------------------------------------------

-- Nome da instância no servidor Evolution: barberia_<nome_normalizado>_<uuid_12chars>
-- Único globalmente para evitar colisão entre barbearias no mesmo servidor Evolution.
alter table public.integration_accounts
  add column if not exists evolution_instance_name text unique;

-- Cache do número pareado (dígitos apenas, ex: 5511999998888)
-- Evita consultar a Evolution a cada envio; atualizado via webhook CONNECTION_UPDATE.
alter table public.integration_accounts
  add column if not exists display_phone_number text;

-- Cache do nome do perfil WhatsApp (ex: "Barbearia do TICO")
-- Atualizado via webhook CONNECTION_UPDATE.
alter table public.integration_accounts
  add column if not exists profile_name text;

-- Timestamp da conexão bem-sucedida (estado 'open' na Evolution)
-- Usado para auditoria e ordenação.
alter table public.integration_accounts
  add column if not exists connected_at timestamptz;

--------------------------------------------------------------
-- Índice para busca rápida por nome da instância (webhook, admin)
--------------------------------------------------------------
create index if not exists idx_integration_accounts_evo_instance
  on public.integration_accounts (evolution_instance_name)
  where evolution_instance_name is not null;

--------------------------------------------------------------
-- Comentários para documentação
--------------------------------------------------------------
comment on column public.integration_accounts.evolution_instance_name is
  'Nome da instância no Evolution API: barberia_<nome_normalizado>_<uuid_12chars>. Derivado server-side, imutável após criação.';

comment on column public.integration_accounts.display_phone_number is
  'Número WhatsApp pareado (apenas dígitos). Cache atualizado pelo webhook CONNECTION_UPDATE.';

comment on column public.integration_accounts.profile_name is
  'Nome do perfil WhatsApp Business. Cache atualizado pelo webhook CONNECTION_UPDATE.';

comment on column public.integration_accounts.connected_at is
  'Data/hora da conexão bem-sucedida (estado open na Evolution).';

--------------------------------------------------------------
-- Função auxiliar: gera nome da instância Evolution a partir do nome da barbearia
-- Usada pelas Edge Functions (server-side). Não exposta ao cliente.
--------------------------------------------------------------
create or replace function private.evolution_instance_name(
  p_barbershop_id uuid,
  p_nome text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_slug text;
  v_short_id text;
begin
  -- Normaliza o nome: remove acentos, minúsculas, não-alfanuméricos viram _
  v_slug := lower(regexp_replace(
    regexp_replace(p_nome, '\s+', '_', 'g'),
    '[^a-z0-9_]', '', 'g'
  ));
  -- Remove underscores duplicados e das pontas
  v_slug := regexp_replace(v_slug, '_+', '_', 'g');
  v_slug := trim(both '_' from v_slug);
  -- Limita tamanho
  v_slug := left(v_slug, 50);

  -- 12 primeiros chars do UUID (sem hífens) para unicidade
  v_short_id := left(replace(p_barbershop_id::text, '-', ''), 12);

  return 'barberia_' || v_slug || '_' || v_short_id;
end;
$$;

revoke all on function private.evolution_instance_name(uuid, text) from public, anon, authenticated;
grant execute on function private.evolution_instance_name(uuid, text) to service_role;

--------------------------------------------------------------
-- Garantia: se já existe row sem evolution_instance_name, preenche retroativamente
-- (executa uma vez na aplicação; Edge Functions usam a mesma lógica)
--------------------------------------------------------------
do $$
declare
  v_row record;
begin
  for v_row in
    select ia.barbershop_id, b.nome
    from public.integration_accounts ia
    join public.barbershops b on b.id = ia.barbershop_id
    where ia.provider = 'whatsapp'
      and ia.evolution_instance_name is null
  loop
    update public.integration_accounts
    set evolution_instance_name = private.evolution_instance_name(v_row.barbershop_id, v_row.nome),
        atualizado_em = now()
    where barbershop_id = v_row.barbershop_id
      and provider = 'whatsapp';
  end loop;
end;
$$;