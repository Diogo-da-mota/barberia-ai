-- 0024 — Chave de IA da barbearia (OpenAI ou Anthropic), usada pela Assistente (Configurações › Assistente).
-- Uma chave por barbearia. Só a Edge Function `ai-credentials` (service_role) lê e grava: a chave fica cifrada
-- (AES-256-GCM com a barbearia como dado associado; segredo AI_CREDENTIALS_KEY) e nunca volta ao navegador.
-- O navegador recebe só o provedor, os 4 últimos caracteres e a data. Mesmo modelo de calendar_credentials (0009).
create table public.ai_credentials (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  provedor text not null check (provedor in ('openai', 'anthropic')),
  chave_cifrada text not null,
  final text not null check (char_length(final) = 4),
  atualizado_em timestamptz not null default now()
);

alter table public.ai_credentials enable row level security;
revoke all on table public.ai_credentials from public, anon, authenticated;
