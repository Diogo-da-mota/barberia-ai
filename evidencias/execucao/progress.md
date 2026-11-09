# Ledger — plan: /Users/diogomota/Documents/GitHub/Barberia AI/PLANO_IMPLEMENTACAO.md

Projeto fora de git: sem commits (CLAUDE.md proíbe commit/push/deploy). Baseline: tsc/eslint 0 erros, vitest 304/304.

Pre-flight: F07→F08 (comissão/booking_events → outbox: sem conflito), F09/F10/F11 independentes entre si; 0005 redefine set_booking_status da 0004 (mesma assinatura).

Ruling: sem worktree/git — executar no diretório atual, ledger em evidencias/execucao — o projeto não é repositório git e a regra do usuário proíbe commit — custo: sem diff de revisão automático.
Ruling: pagamentos só como forma declarada, gestão registra (barbeiro não) — F07-02/segurança — custo: barbeiro não lança pagamento.
Ruling: sem regra de comissão aplicável não há comissão — evitar inventar percentual — custo: gestão precisa cadastrar regra padrão.
Ruling: estorno de atendimento com comissão liquidada é recusado (commission_settled) — sem saldo negativo indevido — custo: ajuste manual futuro.
Ruling: barbearia com histórico financeiro não é apagada (on delete restrict).
Ruling: set_integration_status só service_role — o proprietário não pode se auto-declarar “canal ativo” sem credenciais no servidor.
Ruling: lembrete 24h só se a reserva foi feita com >24h de antecedência; 2h sempre que faltarem 15min–2h; sem consentimento não envia.
Ruling: correlação de SIM/NÃO só por provider_message_id de mensagem enviada por nós + telefone + inicio atual da reserva.

Task F07 (0005_financeiro.sql): complete — supabase/tests/financeiro.test.ts 17/17 (RED visto: ENOENT da migration)
Task F08-DB (0006_eventos.sql): complete — supabase/tests/eventos.test.ts 21/21
Task F09 (0007_site.sql): complete — supabase/tests/site.test.ts 12/12
Task F11 (0008_planos.sql): complete — supabase/tests/planos.test.ts 14/14 (RED visto no limite/horário do teste; migration correta)
Task F10 (0009_calendario.sql): complete — supabase/tests/calendario.test.ts 13/13 (inclui my_professional)
Task F08-edge (supabase/functions): complete — supabase/tests/functions.test.ts 8/8 (HMAC, parser, mensagens, evento Google); funções Deno NÃO implantadas
Task F12-struct: supabase/tests/migracoes.test.ts 9/9 (RLS em todas as tabelas, grants, search_path, funções de servidor só service_role)
Task UI: finance (10 testes), messaging (4), site (8), plans (3) + Shell/rotas; /dashboard/financeiro, /mensagens, /site; cartões Plano/Calendar/Preferências em /dashboard/mais
Ruling: Shell ganhou só "Financeiro" (barbeiro vê "Meus ganhos" na própria tela); Mensagens e Meu site ficam em Mais — sidebar curta.
Ruling: preços dos planos NULOS e comercial=false; billing real bloqueado (F11-02) — decisão de negócio
Ruling: Google Calendar unidirecional (Barberia→Google), tokens só no servidor, escopo calendar.events
Ruling: violeta trocado para #7C3AED — o teste de contraste (4,5:1) reprovou #8B5CF6
Verificação (2026-11-06): tsc 0 erros · vitest 31 arquivos / 424 testes · eslint 0 erros (12 avisos antigos) · build OK
Final: security-audit focado (F12-01) — 1 risco reproduzido (spam a terceiros via WhatsApp não verificado); fixed phone_blocklist + limite 12/24h — eventos.test 2 testes RED→GREEN, suíte banco 172/172
Final: fixed cor de destaque (--color-primary) — domain.test RED→GREEN + estilo computado no Chrome
Final: Ruling: limite de 12 msgs/24h por número (não 6) — 3 reservas × 3 avisos — custo: um spammer ainda alcança 12 msgs/dia por número
Final: minor (deferred): token do Google sem criptografia própria; state OAuth não amarrado à sessão; corpo do webhook lido antes do limite de tamanho; listagem pública do bucket site-media
Final: Chrome (rede simulada) 63/63 em todas as páginas, 390 e 1440px, 4 papéis
Ajuste: header do painel com Ver site (sidebar sem Página pública); template único SiteTemplate (/e/:slug + pré-visualização); /dashboard/site em 4 seções com preview ao vivo; Chrome 67/67
Ajuste: layout fixo (Shell relative + overscroll-contain; /minhas-reservas no Shell); Chrome 106/106 incl. 39 checks de layout fixo
Ajuste: cards de serviços lado a lado (ServiceCard único no painel e no público), foto por serviço (migration 0010 + aplicar/0010.sql), leitura tolerante antes da 0010
Ajuste: dinheiro 00,00 (MoneyInput), cards afastados, ServiceCard com carrossel, BookingDialog + Calendar shadcn, galeria 5 fotos + avatar profissional (0011 aplicada via CLI)
Ajuste: migrations 0010 (serviço) e 0011 (profissional) separadas; grant de avatar_path aplicado no remoto (Equipe dava 403)
Ajuste: sem 0011; foto do profissional na 0007, contato na 0002, grant na 0004; diferença aplicada no remoto; Equipe/pop-up em cards; ProfessionalPhoto em todas as telas
Ajuste: fotos coladas na borda esquerda (ProfessionalCard, ServiceCard, Horários, cadastro, tags)
Ajuste: cards com foto quadrada, ações em coluna à direita (editar em cima, excluir embaixo), rodapé do serviço quebra linha (sem sobreposição); detector impeccable rodado
Ajuste: telefone com +55 fixo (prefixo, não dígito) corrigido; diálogo do profissional com Nome|Telefone, E-mail|CPF e serviços lado a lado
Ajuste: cards restaurados ao visual anterior; só foto quadrada, lápis/lixeira à direita e sem sobreposição
Ajuste: diálogo do profissional: 3 caixas na mesma linha e Salvar ao lado da foto
Mensagens: cards de reserva + pop-up (aceitar/reagendar/pagamento/cancelar); pagamento após aceitar e trava de cancelamento com pagamento (migrations 0005/0006 editadas; diferença em supabase/aplicar/diferenca-pagamento.sql AGUARDANDO aplicação pelo usuário)
Telefone global (+55, PhoneInput, formatPhone na exibição, 0 antes do DDD) e lixeira nos cards de mensagem (delete_outbox_event na 0006; diferença em supabase/aplicar/diferenca-lixeira-mensagem.sql AGUARDANDO aplicação)
Portas separadas: botão Acesso na barbearia, /e/:slug/minhas-reservas, /acesso, StaffRoute, Painel só p/ equipe
Pagamento a confirmar (0005: confirm_payment/discard_payment; diferença supabase/aplicar/diferenca-confirmacao-pagamento.sql AGUARDANDO aplicação), selects com ícones (OptionSelect), campos de data/hora (ui/date-time.tsx)
Cor de destaque por usuário no site inteiro (data-accent no html, conta, claro/escuro)
Redesign /dashboard (Shell com foto no menu, hero, cartões, calendário, ações rápidas). Fotos editáveis dependem de migration (pendente de aprovação).
