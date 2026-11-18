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

## Fotos no AWS S3 (migration 0023; nada ativado ainda)
Fotos em `BARBEARIA/<id da barbearia>/` (`site/logo|capa|galeria`, `painel/inicio|agendamentos|servicos|sidebar|financeiro`, `login`, `servicos/<serviço>`, `profissionais/<profissional>`), bucket privado lido pelo CloudFront. Envio e remoção só pela Edge Function `media` (proprietário/gerente da barbearia dona da pasta; tipo pelo conteúdo; até 2 MB). Cada envio tem nome único e a foto substituída é apagada: uma foto por posição, sem versões e sem cache antigo. Documentos privados continuam no Supabase (`shop-documents`). Rode na ordem, com `!`:
1. **AWS** (CLI logado na conta): `aws cloudformation deploy --region sa-east-1 --stack-name barberia-midia --template-file infra/aws/midia.yaml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides BucketName=barberia-midia` (nome em uso? troque o `BucketName`). Saídas: `aws cloudformation describe-stacks --region sa-east-1 --stack-name barberia-midia --query "Stacks[0].Outputs" --output table`. Chave do usuário de envio: `aws iam create-access-key --user-name barberia-midia-envio`.
2. **Segredos:** `supabase secrets set --project-ref hbkbdqctelembzqiptpi AWS_REGION=sa-east-1 AWS_S3_BUCKET=<Bucket> AWS_ACCESS_KEY_ID=<...> AWS_SECRET_ACCESS_KEY=<...> MEDIA_MIGRATE_SECRET=<aleatório>`.
3. **Funções:** `supabase functions deploy media --project-ref hbkbdqctelembzqiptpi` e `supabase functions deploy media-migrate --project-ref hbkbdqctelembzqiptpi`.
4. **Banco:** `supabase db query --remote --yes -f supabase/aplicar/0023.sql` (a partir daqui o painel só envia fotos para o S3).
5. **Frontend:** `VITE_MEDIA_CDN_URL=<CdnUrl>` no `.env` local e na Vercel; reiniciar o `npm run dev`.
6. **Cópia das fotos atuais** (segredo `MEDIA_MIGRATE_SECRET`, guardado no Keychain como `barberia-media-migrate`): `curl -s -X POST https://hbkbdqctelembzqiptpi.supabase.co/functions/v1/media-migrate -H "Authorization: Bearer <anon>" -H "x-migrate-secret: $(security find-generic-password -s barberia-media-migrate -w)" -H "Content-Type: application/json" -d '{"acao":"simular"}'`; depois o mesmo com `"copiar"` (copia, confere no S3 e só então troca o caminho no banco; nada é apagado do Supabase). Rodar `"copiar"` de novo só pega o que faltou.
**CORS (Ajustar logo/capa):** a política gerenciada SimpleCORS do CloudFront não responde com CORS quando o Chrome envia o cabeçalho `priority` (todo fetch do Chrome). Por isso o CORS vem do S3 (`CorsConfiguration` do bucket, só GET/HEAD) e a política de cache `barberia-midia-cache` põe `Origin` na chave; o editor baixa a foto atual com `cache: "no-store"`.
7. **Conferir** o site e o painel. Só então `"apagar-antigas"`: recusa se algum registro ainda apontar para o Supabase ou se faltar arquivo no S3; senão apaga as fotos do bucket `site-media`.
8. **Cota e limpeza dos envios (migration 0041):** aplicar a 0041 ANTES de publicar a nova `media` (sem ela todo envio dá erro). Cada barbearia pode fazer até 200 envios em 24 h e ter até 30 envios ainda sem registro; acima disso a tela recebe `upload_limit`. Limpeza diária automática (0050 + 0051): o Supabase Cron chama `media-migrate` com `{"acao":"limpar-orfaos"}` às 06:00 UTC (03:00 de Brasília), job `barberia-limpeza-midia`, e às 06:20 UTC o job `barberia-limpeza-midia-resultado` grava o resultado. Apaga do S3 só envios anotados pela `media` com mais de 24 h, sem nenhum registro, reservados antes da exclusão (nunca imagem em uso nem imagem anterior à 0041), até 100 por dia. Segredos no Vault (`sh supabase/aplicar/segredos-limpeza-midia.sh`, que confere o segredo do Keychain com o publicado). Histórico: `select * from private.media_cleanup_runs order by id desc limit 10;` (status, encontrados, apagados, falhas, erro curto). Execuções: `select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'barberia-limpeza-midia') order by start_time desc limit 10;`. Desligar: `select cron.unschedule('barberia-limpeza-midia');` (religar: reaplicar o bloco final da 0051). Rodar na hora: `select private.start_media_cleanup();` e, depois de 1 min, `select private.collect_media_cleanup();`.

## Chave de IA da Assistente (migration 0024 aplicada e função publicada em 2026-11-15; falta o passo 1)
Configurações › Assistente guarda uma chave de API (OpenAI ou Anthropic) por barbearia. O uso é cobrado pelo provedor, na conta de quem criou a chave.
1. **Segredo (32 bytes aleatórios):** `! supabase secrets set AI_CREDENTIALS_KEY="$(openssl rand -base64 32)" --project-ref hbkbdqctelembzqiptpi`. Trocar este segredo invalida todas as chaves salvas (as barbearias precisam colar de novo).
2. **Função:** `! supabase functions deploy ai-credentials --project-ref hbkbdqctelembzqiptpi`.
3. **Banco:** `! supabase db query --remote --yes -f supabase/aplicar/0024.sql` (conferência só leitura no cabeçalho do arquivo).
- A chave nunca volta ao navegador nem vai para o log; o navegador recebe só provedor, 4 últimos caracteres e data.
- **Instruções da Lara (0025):** primeiro `! supabase db query --remote --yes -f supabase/aplicar/0025.sql`, depois publicar a função `assistant` (abaixo). Sem a 0025 a tela avisa e a Lara segue sem instruções.
- **Chat da assistente:** `! supabase functions deploy assistant --remote=hbkbdqctelembzqiptpi --yes`. Usa a chave salva (sem chave → aviso na tela). Cada pergunta faz até 5 chamadas ao provedor, cobradas na conta da chave. Modelos: `OPENAI_MODEL` e `claude-opus-5-5` em `supabase/functions/_shared/assistant.ts` e `assistant/index.ts`.
- **Assinatura do ChatGPT:** não implementada. Pela documentação da OpenAI (developers.openai.com/siwc, nov/2026), usar o plano ChatGPT do usuário vale para apps de código aberto ou hospedados localmente; app pago ou hospedado remotamente precisa entrar pelo formulário de interesse e ser aprovado. O fluxo de outros projetos (retorno em `127.0.0.1` colado à mão) é para app local e não serve para a Barberia. Se a OpenAI aprovar a Barberia, rever.

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
