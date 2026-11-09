-- DIFERENÇA a aplicar no banco remoto: textos padrão da confirmação e do lembrete no formato com ícones.
-- A 0019 já está no remoto (aplicada em 2026-11-07) com o texto padrão antigo. Esta diferença:
--   1. troca o valor padrão das colunas (barbearias novas já nascem com o formato com ícones);
--   2. troca o texto só das barbearias que ainda usam o padrão antigo (quem personalizou continua com o próprio texto).
-- Igual a supabase/migrations/0019_textos_mensagens.sql (editada). Pode ser reaplicado sem efeito.
-- ATENÇÃO: os textos novos usam {falta} e {data} só com dia/mês: publique antes o outbox-worker com messages.ts atualizado.
--   ! supabase functions deploy outbox-worker --use-api --no-verify-jwt --yes
--   ! supabase db query --remote --yes -f supabase/aplicar/diferenca-textos-icones.sql
begin;

alter table public.barbershops
  alter column msg_confirmacao set default E'✅ Olá, {nome}! Seu agendamento está confirmado.\n\n✂️ Serviço: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n🕔 Horário: {hora}\n📍 Local: {barbearia}',
  alter column msg_lembrete set default E'⏰ Olá, {nome}! {falta} para o seu atendimento!\n\n✂️ Serviço: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n🕔 Horário: {hora}\n📍 Local: {barbearia}';

update public.barbershops set msg_confirmacao = E'✅ Olá, {nome}! Seu agendamento está confirmado.\n\n✂️ Serviço: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n🕔 Horário: {hora}\n📍 Local: {barbearia}' where msg_confirmacao = E'Olá, {nome}! Sua reserva em {barbearia} está confirmada.\n{servico} com {profissional}, {data} às {hora}.\nEndereço: {endereco}';
update public.barbershops set msg_lembrete = E'⏰ Olá, {nome}! {falta} para o seu atendimento!\n\n✂️ Serviço: {servico}\n👤 Profissional: {profissional}\n📅 Data: {data}\n🕔 Horário: {hora}\n📍 Local: {barbearia}' where msg_lembrete = E'Olá, {nome}! Lembrete: seu horário em {barbearia} está chegando.\n{servico} com {profissional}, {data} às {hora}.\nEndereço: {endereco}';

commit;
