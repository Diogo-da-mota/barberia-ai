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

## Confirmação pelo WhatsApp (Evolution; 0026 aplicada e `evolution-webhook` publicado em 2026-11-16; 0027 aplicada em 2026-11-16 com autorização do usuário, não reexecutar)
Só o lembrete pede resposta: termina com o bloco `REMINDER_REPLY` ("📲 Confirme sua presença: ✅ Responda *SIM*… ❌ Responda *NÃO*…"), que já faz parte do texto padrão; texto antigo salvo sem "SIM" ganha o bloco no editor e no envio (`withReminderReply`, uma vez só). A confirmação da reserva não pede resposta e não é correlacionada. A resposta chega pela instância da barbearia em `evolution-webhook` → `process_whatsapp_reply` (0027): **SIM** registra a presença (`booking_events` tipo `presenca`) mesmo com a reserva já confirmada (pendente vira confirmado) e o webhook responde "Obrigado por confirmar, <nome da barbearia> agradece!"; **NÃO** registra e responde "Obrigado por responder! Gostaria de reagendar?", **sem cancelar**; PARAR bloqueia. Uma resposta por lembrete (a seguinte fica `ja_respondido`, sem nova resposta automática); reenvio da Evolution fica `duplicado`; mensagens da própria barbearia (`fromMe`) são ignoradas. Sem citar o aviso, só vale se o número tiver **uma** reserva futura na barbearia e o último lembrete dela tiver saído há até 12 h. Resultado em Mensagens › respostas.
0. **0027 (FEITO em 2026-11-16, não reexecutar)** e `evolution-webhook` v2 (FEITO em 2026-11-16); pendente: `supabase functions deploy outbox-worker --no-verify-jwt --remote=hbkbdqctelembzqiptpi --yes` (o texto do lembrete está no `_shared`).
1. **Banco (antes da função; FEITO em 2026-11-16, não reexecutar):** `! supabase db query --remote --yes -f supabase/aplicar/0026.sql` (conferência só leitura no cabeçalho do arquivo).
2. **Função:** `! supabase functions deploy evolution-webhook --no-verify-jwt --remote=hbkbdqctelembzqiptpi --yes` (a autenticidade vem do cabeçalho `x-webhook-secret`, segredo `EVOLUTION_WEBHOOK_SECRET`, o mesmo do worker).
3. **Teste real (só com número próprio/autorizado):** reserva para daqui a ~40 min com o seu WhatsApp, esperar o lembrete, responder `SIM` e conferir em Mensagens a linha "Confirmou". O webhook da instância é gravado ao conectar (Mais › Integração WhatsApp); instância conectada antes do deploy: desconectar e conectar de novo, se as respostas não chegarem.
- O NÃO nunca cancela (0027): a reserva continua e a gestão reagenda ou cancela pelo painel.
- **Reagendamento pelo WhatsApp**. A 0028 está em produção desde 2026-11-16. A atualização local mantém o NÃO seguido de SIM e inclui o ID da reserva no link da própria barbearia. A conta do cliente precisa ter acesso à reserva. Com a atualização, o reagendamento fica disponível até o horário original começar, inclusive para a equipe. A confirmação sai pela fila da Evolution com os dados da reserva. Se o envio ficar incerto, a Central registra a falha para evitar duplicação.
- **Publicação pendente**. Publicar `outbox-worker`, aplicar `supabase/aplicar/diferenca-reagendamento.sql` pelo Supabase e publicar a aplicação e `evolution-webhook`. Manter `APP_URL` apontando para a aplicação. Testar com uma conta de cliente e um número próprio, do lembrete à confirmação do novo horário.
- O `outbox-worker` atende a fila de **todas** as barbearias: antes de disparar à mão para teste, conferir (só leitura) que a fila só tem a reserva de teste.

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
