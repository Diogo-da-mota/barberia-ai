# OPERACAO.md — setup, operação, limitações e release

## Setup local
1. `npm install` · `cp .env.example .env` e preencher só `VITE_*` (chave **publicável** do projeto `hbkbdqctelembzqiptpi`).
2. `npm run dev` (http://localhost:5173) · `npm test` (inclui o banco em PGlite) · `npx tsc -b` · `npx eslint .` · `npm run build`.
3. Teste de navegador com rede simulada: `evidencias/execucao/todas-as-paginas.e2e.mjs.txt` (instruções no topo do arquivo).

## Aplicar migrations (somente com autorização)
`supabase/aplicar/0004.sql`, depois `supabase/aplicar/0005-0009.sql` (cada um em uma transação). O agente não grava em produção: rodar com `!`.
Conferir depois por leitura: `supabase db query --remote --read-only "select count(*) from public.plans"`.

## O que depende de contas externas (nada disso foi ativado)
| Item | Falta | Como ligar |
|---|---|---|
| WhatsApp (F08-03/04) | Conta WhatsApp Business aprovada, número, modelos de mensagem | `supabase secrets set WHATSAPP_*` e `WORKER_SECRET`; `supabase functions deploy whatsapp-webhook --no-verify-jwt` e `outbox-worker --no-verify-jwt`; agendar o worker a cada 1–5 min; no banco (service_role) `select set_integration_status('<barbearia>', 'whatsapp', 'ativo'); select release_blocked_outbox('<barbearia>');` |
| Google Calendar (F10) | Projeto Google Cloud com Calendar API e tela de consentimento | `GOOGLE_CLIENT_ID/SECRET`, `APP_URL`; implantar `google-calendar-oauth`; `set_integration_status(..., 'google_calendar', 'ativo')`; `VITE_GOOGLE_CALENDAR_ENABLED=true` |
| Cobrança (F11-02/03) | Escolher provedor, preços e moeda | Criar função que valide a assinatura do provedor e chame `apply_billing_event` (service_role); marcar `plans.comercial` e `preco_mensal_centavos` |
| Vercel (F12-05) | Projeto e domínio | Variáveis publicáveis `VITE_*` no painel; redirect OAuth `https://<domínio>/auth/callback` no Supabase Auth e no Google; **deploy só com autorização** |

## Logs e dados pessoais
- Edge Functions não registram corpo de mensagem, telefone nem token: só `error.code`. Manter assim.
- O painel de mensagens mascara o telefone. `outbox_events.payload` e `destino` guardam nome e telefone do cliente: reter 90 dias (decisão de retenção pendente; limpar `outbox_events`, `notification_logs` e `inbound_webhook_events` por data).
- Backup: ativar PITR/backups diários do Supabase; testar restauração em um projeto separado antes do release (nunca sobre produção).

## Rotação de segredos
Trocar um por vez com `supabase secrets set` e conferir o worker: `WORKER_SECRET` e `WHATSAPP_APP_SECRET` (rotacionar também no provedor), tokens do Google (revogar em conta Google e pedir novo vínculo). A chave `service_role` nunca vai para o navegador, nem para o n8n.

## Incidentes
1. Vazamento de segredo: rotacionar (acima), revisar `inbound_webhook_events` e `notification_logs` do período.
2. Mensagens indevidas: `select set_integration_status('<barbearia>', 'whatsapp', 'suspenso')` e cancelar a fila (`update outbox_events set status='cancelado' where status in ('pendente','bloqueado')`).
3. Cliente pede para parar: responder PARAR no WhatsApp (bloqueia o número na barbearia que enviou) ou `insert into phone_blocklist (barbershop_id, telefone) values ('<barbearia>', private.br_phone_key('<número>'))`.
4. Pagamento lançado errado: estorno pelo painel (o razão é imutável); comissão já repassada exige ajuste manual.

## Limitações conhecidas e decisões pendentes
- **WhatsApp do cliente não é verificado** (sem OTP). Mitigado por `PARAR`, bloqueio por número e limite de 12 mensagens/24h por número; verificação por código é decisão de produto.
- Token do Google guardado em tabela sem acesso da API, mas **sem criptografia própria** (considerar Supabase Vault antes de produção).
- O `state` do OAuth do Google é de uso único e expira em 10 min, mas não é amarrado à sessão do navegador (risco baixo: no pior caso, reservas de outra pessoa aparecem no calendário de quem autorizar).
- Mensagens iniciadas pela empresa fora da janela de 24h do WhatsApp exigem modelos aprovados; `sendWhatsApp` envia texto livre e precisa ser adaptado.
- Entrega do outbox é "pelo menos uma vez": uma queda do worker pode repetir uma mensagem.
- Pagamentos são registros declarados; não há conciliação com banco ou maquininha.
- Preços dos planos, política de cancelamento por plano e retenção de dados: decisão de negócio/jurídica pendente (LGPD).
- Um dono pode criar até 3 barbearias (cada uma com teste de 14 dias).

## Checklist de release (nada marcado sem evidência)
- [ ] `0004` e `0005–0009` aplicadas no remoto e conferidas por leitura
- [ ] E2E repetido contra o banco real com contas dos 4 papéis
- [ ] Decisões pendentes acima respondidas; política de privacidade e termos revisados
- [ ] WhatsApp / Google / cobrança ativados **ou** declarados fora do release
- [ ] Deploy autorizado pelo responsável
