# PLANO DE IMPLEMENTAÇÃO — BARBERIA AI

**Versão:** 1.0  
**Situação:** plano de execução; nenhuma funcionalidade é considerada implementada por constar neste documento.  
**Diretório do projeto:** `/Users/diogomota/Documents/GitHub/Barberia AI`  
**Supabase autorizado:** `hbkbdqctelembzqiptpi`

## 1. Missão e critérios de sucesso

Construir do zero o **Barberia AI**, um SaaS multiempresa de agendamento de barbearias, com interface consistente, código modular, segurança verificável e capacidade de expansão. **Implementação real** é o objetivo; arquivos Markdown apenas organizam e auditam o trabalho.

**Resultado mínimo de negócio (MVP):** um proprietário autentica-se com Google, cadastra sua barbearia, adiciona barbeiros, serviços, preços, durações, jornadas e bloqueios; um cliente consulta a disponibilidade e realiza um agendamento; o horário aparece na agenda correta e não pode ser reservado duas vezes, mesmo com requisições simultâneas. O cliente consegue consultar, cancelar e reagendar conforme políticas explícitas. O acesso entre empresas é isolado e os fluxos são testados.

**Expansões planejadas:** painéis completos, financeiro, WhatsApp/n8n, identidade visual de cada empresa, Google Calendar, planos e assinaturas. Esses módulos **não** devem bloquear a entrega do núcleo de agendamento.

## 2. Documentos obrigatórios e precedência

Antes de escrever código, abrir e ler integralmente estes **três documentos**:

1. `Segurança.md` — regras obrigatórias de autenticação, autorização, integridade, proteção de dados e testes.
2. `Design Sytem.md` — identidade visual, tokens, componentes e regras de UI existentes. Preservar exatamente esse nome até decisão explícita de renomear.
3. `PLANO_IMPLEMENTACAO.md` — fases, dependências, escopo, arquitetura e critérios de aceite deste documento.

**Precedência:** requisitos de segurança nunca podem ser reduzidos por conveniência; o Design System governa aparência e interação; o plano governa escopo e sequência. Havendo conflito, documentar a diferença no `CHECKLIST.md`, propor solução e **não inventar** o conteúdo do arquivo que não foi lido. O prompt de construção anterior e seus requisitos permanecem referência de produto, desde que compatíveis com os três arquivos.

**Outros arquivos a criar durante a execução:** `PRODUCT.md` (regras do produto), `CHECKLIST.md` (tarefas e evidências), `README.md` (setup), `.env.example` (somente nomes e exemplos sem segredos). Um eventual `DESIGN.md` pode ser apenas índice para o arquivo de design existente, sem substituí-lo.

## 3. Limites técnicos obrigatórios

- **Frontend:** React 18+ compatível com Vite, TypeScript, React Router, Tailwind CSS, shadcn/ui e Radix UI; TanStack Query para estado remoto. Usar versões estáveis compatíveis identificadas no início do trabalho, sem fixar versões desatualizadas arbitrariamente.
- **Backend:** Supabase PostgreSQL, Supabase Auth com Google OAuth, Edge Functions e RPC PostgreSQL para operações críticas transacionais.
- **Testes:** Vitest para regras e componentes, testes de integração em PostgreSQL real, pgTAP para RLS, testes E2E no navegador; usar Agent Browser/Playwright apenas se disponível e adequado.
- **Infraestrutura futura:** Vercel, GitHub; AWS S3 somente quando uploads reais exigirem.
- **Integrações posteriores:** WhatsApp Business autorizado, n8n, Google Calendar, provedor de cobrança aprovado.
- **Proibições:** Next.js, NextAuth, Prisma, frontend e backend como projetos isolados, credenciais de servidor no navegador, serviços pagos criados sem autorização.

## 4. Arquitetura e convenções

```text
Barberia AI/
├── .env                         # existente: preservar
├── .env.example                 # sem segredos
├── Segurança.md                 # existente: preservar
├── Design Sytem.md              # existente: preservar
├── PLANO_IMPLEMENTACAO.md       # este plano
├── PRODUCT.md
├── CHECKLIST.md
├── README.md
├── public/
├── src/
│   ├── app/                     # providers, rotas, layouts, navegação
│   ├── features/
│   │   ├── auth/
│   │   ├── barbershops/
│   │   ├── professionals/
│   │   ├── services/
│   │   ├── availability/
│   │   ├── bookings/
│   │   ├── customers/
│   │   ├── owner-dashboard/
│   │   ├── barber-dashboard/
│   │   ├── finance/
│   │   ├── automations/
│   │   ├── calendar-sync/
│   │   ├── branding/
│   │   └── billing/
│   ├── components/ui/           # componentes genéricos de interface
│   ├── domain/                  # tipos, estados, regras puras
│   ├── lib/                     # clientes e utilitários compartilhados
│   └── styles/                  # tokens importados do Design System
├── supabase/
│   ├── migrations/
│   ├── functions/
│   ├── seed.sql                 # apenas dados fictícios de teste
│   └── tests/                    # pgTAP e testes de políticas
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

**Critérios arquiteturais:** separar componentes de apresentação de regras e acesso a dados; feature tem seus próprios componentes, validações, consultas e testes; evitar arquivos gigantes, dependências circulares, abstrações antecipadas e regras críticas exclusivamente no React. O banco valida invariantes; o backend valida identidade, autorização e entradas; o frontend melhora a experiência sem ser fronteira de segurança.

## 5. Papéis e isolamento multiempresa

| Papel | Pode fazer | Não pode fazer |
|---|---|---|
| Proprietário | Configurar sua empresa, equipe, serviços, agenda, financeiro e permissões permitidas | Ler ou alterar dados de outra empresa |
| Gerente | Operar agenda, equipe e clientes conforme permissões concedidas | Tornar-se proprietário sozinho ou acessar outras empresas |
| Barbeiro | Consultar sua agenda, histórico e ganhos; propor/editar horários se autorizado | Consultar ganhos de outros barbeiros sem permissão |
| Cliente | Consultar seus agendamentos e solicitar alterações permitidas | Acessar dados internos, financeiros ou de outros clientes |

- Uma conta pode pertencer a mais de um estabelecimento, com **papel por estabelecimento**, não global. A troca de empresa ativa na interface não autoriza acesso por si mesma.
- Proprietário é atribuído somente por fluxo de criação de empresa validado no servidor. Adição e alteração de funcionários por convite/fluxo autorizado; nenhuma elevação de papel por `user_metadata` ou payload do cliente.
- Tabelas privadas devem usar `barbershop_id`, chaves estrangeiras que preservem vínculos corretos, RLS e permissões SQL coerentes. Acesso público é **somente** às informações publicáveis, por view segura ou endpoint específico.
- Criar usuários e duas empresas fictícias nos testes para demonstrar isolamento positivo e negativo em SELECT, INSERT, UPDATE e DELETE.

## 6. Regras de produto fundamentais

### 6.1 Empresas, profissionais e serviços

- Empresa: nome, slug único para página pública, endereço, telefone, descrição, timezone IANA, dias e horas de funcionamento, identidade visual, status.
- Profissional: vínculo à empresa e, quando aplicável, conta autenticada; nome, foto, contatos autorizados, serviços habilitados, agenda individual, intervalos, folgas e política de comissões.
- Serviço: nome, descrição, preço em centavos, duração positiva em minutos, ativo/inativo e profissionais elegíveis; combo é um serviço composto ou categoria equivalente, com duração e preço explícitos.
- Cliente: nome, telefone com DDD normalizado, vínculo com empresa, histórico, preferências de comunicação e consentimentos com finalidade e data. Não supor que informar telefone comprova sua titularidade.

### 6.2 Agendamento e disponibilidade

1. Cliente seleciona empresa, serviço, profissional específico ou **qualquer disponível**, data e horário.
2. Interface consulta slots resultantes de jornada, pausas, exceções, férias, horários já ocupados, duração real e timezone da empresa.
3. O servidor recalcula tudo na confirmação; slot exibido **não** é garantia de reserva.
4. Reserva é criada em **uma transação PostgreSQL**, com verificação autorizada, identificação atômica do profissional quando a escolha for "qualquer disponível", verificação de limites e integridade.
5. O banco impede dois intervalos sobrepostos para o mesmo profissional, inclusive sob dez requisições concorrentes. Dois profissionais diferentes podem trabalhar ao mesmo tempo. Intervalos contíguos são válidos.
6. Bloqueios e reservas ocupam o **mesmo recurso de agenda**. Preferir modelo de ocupação único, com `tstzrange` semiaberto `[início, fim)` e `EXCLUDE USING gist` para `(professional_id, intervalo)` nos registros ativos; usar `btree_gist`/índices, se compatíveis. Se houver tabelas separadas, provar equivalência por transação/locks e testes cruzados.
7. Armazenar instantes como UTC (`timestamptz`), converter na UI com timezone IANA da empresa; testar troca de data, meia-noite e horário de verão onde aplicável.
8. No momento da criação, gravar **snapshot de preço, duração e nome do serviço**, além do profissional efetivo. Atualizações futuras do catálogo não reescrevem reservas históricas.
9. Estados de reserva: `pendente`, `confirmado`, `concluído`, `cancelado`, `não_compareceu`. Definir transições permitidas no domínio e validá-las no servidor.
10. Inicialmente limitar a **três reservas futuras ativas por cliente**, por empresa, conforme regra de produto original; fazer cumprir atomicamente.
11. Reagendamento deve liberar o intervalo antigo e ocupar o novo sem janela de inconsistência. Guardar o evento de alteração e o histórico de cancelamento.
12. Política de antecedência, tolerância, janela de cancelamento e restrições de no-show devem ser configuráveis; até sua definição, não expor ações que contornem autorização ou integridade.

### 6.3 Identidade do cliente

- **MVP seguro:** catálogo e horários são públicos; para concluir, consultar histórico próprio, cancelar ou reagendar, exigir sessão autenticada (Google/Supabase) com vínculo validado à reserva. Cadastro solicita nome e WhatsApp para contato.
- **Evolução opcional:** fluxo sem conta usando OTP de posse do telefone ou token de ação com escopo mínimo, validade e uso único. **Não** liberar cancelamento/histórico somente com nome e telefone digitados.
- Separar consentimento para avisos relacionados à reserva de consentimento para **marketing/recuperação de clientes**; manter opt-out auditável.

### 6.4 Dinheiro e repasses

- Valores monetários em **centavos inteiros**, sem ponto flutuante para saldos.
- Separar valor agendado, serviço concluído, pagamento efetivamente recebido, estornos, comissões provisionadas e repasses liquidados.
- Operações financeiras com chave de idempotência e transações; nunca dar baixa ou repassar duas vezes por retry/webhook repetido.
- Relatórios e saldo por barbeiro respeitam permissões e histórico imutável de eventos financeiros.

### 6.5 WhatsApp e integrações

- WhatsApp Business só por canal autorizado e número aprovado da barbearia; n8n orquestra automações, mas não é fonte de verdade da agenda.
- Eventos: reserva criada, confirmada, cancelada, reagendada e atendimento concluído. Publicá-los com **outbox** transacional, rastreabilidade, retentativas limitadas e idempotência.
- Validar autenticidade de webhooks conforme o provedor, incluindo assinatura HMAC quando aplicável e proteção contra replay.
- Resposta SIM/NÃO só altera uma reserva identificada e autorizada; nunca inferir o agendamento apenas por texto e número sem validações suficientes.
- Lembretes configuráveis (ex.: 24h e 2h) e reativação (30/45/60 dias), mediante consentimento e regras do canal; erros devem ficar visíveis ao proprietário sem expor segredos.
- Google Calendar: integração por profissional com consentimento explícito, tokens criptografados/servidor, mapeamento e idempotência. Definir se é unidirecional ou bidirecional **antes** de ativar sincronização de retorno para não gerar conflitos.

## 7. Plano de execução por fases

**Regra de fluxo:** executar **uma tarefa verificável por vez**, com dependências explícitas: **planejar → criar teste → implementar → testar → registrar evidência → atualizar checklist → próxima tarefa**. Status permitido no `CHECKLIST.md`: `[ ]` pendente, `[~]` em desenvolvimento, `[x]` implementado e testado, `[!]` bloqueado.

### Fase 00 — Preparação e leitura obrigatória (P0)

**Objetivo:** confirmar contexto sem alterar o produto.

- `F00-01` Ler integralmente `Segurança.md`, `Design Sytem.md` e este plano.
- `F00-02` Inventariar estrutura e arquivos existentes; preservar `.env` e não exibir segredos.
- `F00-03` Confirmar que a URL Supabase do `.env` aponta ao projeto `hbkbdqctelembzqiptpi`; se houver conflito, **bloquear somente operações de banco**.
- `F00-04` Confirmar versões de Node, npm, Claude Code e dependências; usar Superpowers ativo, security-audit e skills de design somente após inspeção; `grill-me` não deve ser declarado funcional enquanto sua invocação não for corrigida.
- `F00-05` Criar `PRODUCT.md`, `CHECKLIST.md` e decisões técnicas iniciais; estabelecer baseline do projeto.

**Aceite:** arquivos lidos, divergências documentadas, comandos de verificação anotados, nenhum segredo impresso nem arquivo existente sobrescrito.

### Fase 01 — Fundação técnica e Design System (P0; depende da 00)

- `F01-01` Inicializar Vite/React/TypeScript e organização por features.
- `F01-02` Configurar Tailwind, shadcn/ui, Radix, React Router, TanStack Query, lint, TypeScript e scripts.
- `F01-03` Traduzir **fielmente** os tokens e regras do `Design Sytem.md` para CSS/componentes; tema escuro por padrão quando compatível com o documento; variantes, estados e responsividade.
- `F01-04` Criar layout base, rotas públicas/privadas, telas de loading/erro/vazio e tratamento de erros.
- `F01-05` Preparar `.env.example`, `.gitignore`, `README.md` e configuração de testes.

**Aceite:** app local inicia, navegação funciona, build/typecheck/lint/testes básicos passam, sem mudança arbitrária na identidade visual.

### Fase 02 — Autenticação, onboarding e multiempresa (P0; depende da 01)

- `F02-01` Configurar cliente Supabase publicável e Google OAuth, callback, login/logout e sessão; validar provider e URLs reais.
- `F02-02` Criar migrations locais iniciais: `profiles`, `barbershops`, `memberships`, papéis e auditoria mínima.
- `F02-03` Aplicar RLS, grants mínimos, chaves estrangeiras, índices e funções privadas com privilégios estritos.
- `F02-04` Criar empresa e atribuir primeiro proprietário via operação de servidor autenticada e transacional.
- `F02-05` Implementar convites/vínculos de membros, troca de empresa e guardas de rota sem confiar no frontend.
- `F02-06` Escrever testes SQL/pgTAP de papéis e isolamento entre duas empresas.

**Aceite:** proprietário cria sua empresa; cliente não acessa gestão; funcionário não eleva papel; empresas A/B não leem nem alteram dados uma da outra; OAuth testado realmente ou bloqueio externo registrado.

### Fase 03 — Catálogo, equipe e expediente (P0; depende da 02)

- `F03-01` CRUD autorizado de serviços, combos, preço, duração e status.
- `F03-02` CRUD autorizado de profissionais, fotos opcionais, vínculo e serviços realizados.
- `F03-03` Jornada semanal por profissional, pausas/almoço, exceções, folgas, feriados e bloqueios.
- `F03-04` Formulários com validação de UI + servidor, datas e timezone IANA.
- `F03-05` Testes de políticas, conflitos de jornadas, intervalos inválidos e catálogo inativo.

**Aceite:** cada empresa configura sem vazamento seus profissionais, horários e serviços; preços/durações válidos; dados exibidos corretamente em mobile e desktop.

### Fase 04 — Motor transacional de disponibilidade (P0; depende da 03)

- `F04-01` Desenhar entidade de ocupação única para agendamentos e bloqueios; migrations e constraints no PostgreSQL.
- `F04-02` Implementar função de listagem de disponibilidade que respeita fuso, jornada, duração, pausas e intervalos ocupados.
- `F04-03` Implementar RPC/operador transacional de reserva, verificando autorização, cliente, profissional, limite e conflitos.
- `F04-04` Implementar seleção atômica de “qualquer profissional disponível”.
- `F04-05` Implementar cancelamento, reagendamento, confirmação e histórico de transições dentro de transações.
- `F04-06` Persistir snapshots de preço e duração; adicionar proteção de idempotência para criação/requisições repetidas.
- `F04-07` Executar testes de concorrência e integridade com PostgreSQL real.

**Aceite obrigatório:** **10 tentativas simultâneas** para o mesmo profissional e intervalo produzem **1 reserva ativa** e 9 respostas controladas; dois profissionais atendem simultaneamente; slots consecutivos são válidos; bloqueios impedem reservas e vice-versa; reagendamento não duplica ocupação.

### Fase 05 — Jornada pública e painel do cliente (P0; depende da 04)

- `F05-01` Página pública de empresa com nome, endereço, serviços e profissionais habilitados.
- `F05-02` Fluxo serviço → profissional/qualquer → data → horário → identificação → revisão → confirmação.
- `F05-03` Captura de nome e WhatsApp com DDD, normalização e consentimento granular.
- `F05-04` Exibir disponibilidade real, loading, erro, slot tomado durante confirmação e proposta de horário alternativo.
- `F05-05` Área autenticada do cliente: próximas reservas, histórico, cancelamento e reagendamento autorizados.
- `F05-06` Teste E2E completo no desktop e mobile, inclusive reserva perdida por concorrência.

**Aceite:** pessoa real de teste agenda, consulta e altera sua própria reserva; nunca altera reserva de terceiro; horários corretos no fuso da empresa.

### Fase 06 — Painéis do proprietário, gerente e barbeiro (P1; depende da 05)

- `F06-01` Proprietário/gerente: calendário unificado dia/semana/mês, filtros e gestão de atendimentos.
- `F06-02` Proprietário: serviços, profissionais, clientes, configurações, permissões e bloqueios.
- `F06-03` Barbeiro: agenda própria, clientes autorizados, concluídos, cancelados e faltas.
- `F06-04` Operações administrativas de confirmar, concluir, cancelar e marcar ausência, com histórico.
- `F06-05` Indicadores operacionais: atendimentos, comparecimento e ocupação; diferenciar métricas calculadas e estimativas.
- `F06-06` E2E das quatro permissões e testes de navegação responsiva.

**Aceite:** cada papel vê apenas ações e informações autorizadas; agendas consistentes com o motor transacional.

### Fase 07 — Financeiro e comissões (P1; depende da 06)

- `F07-01` Modelo transacional de pagamentos, parcelas, estornos, comissões, ajustes, repasses e trilha de auditoria.
- `F07-02` Registrar PIX/dinheiro/débito/crédito como **forma de pagamento declarada**, sem fingir confirmação de gateway não integrado.
- `F07-03` Calcular comissão fixa ou percentual por profissional/serviço e congelar regra aplicável ao atendimento.
- `F07-04` Relatórios de faturamento previsto versus recebido, custos, comissões e resultados estimados.
- `F07-05` Impedir pagamento, estorno e repasse duplicados por transações e idempotência; testar concorrência.
- `F07-06` RLS financeira: barbeiro só vê seus ganhos; gerente conforme escopo; isolamento de empresa.

**Aceite:** balanços reconciliáveis e trilha de lançamentos; concorrência não duplica valores; não há saldo negativo indevido nem exposição entre profissionais/empresas.

### Fase 08 — WhatsApp, n8n e eventos (P1; depende das fases 05–07, sem bloquear MVP)

- `F08-01` Criar outbox/inbox de eventos com deduplicação, status, tentativas e observabilidade.
- `F08-02` Implementar webhooks assinados, identificação de origem, rate limit e testes de replay.
- `F08-03` Integrar provedor WhatsApp Business aprovado usando credenciais exclusivamente no servidor.
- `F08-04` Confirmação automática: data, fuso/horário, serviço, profissional e endereço.
- `F08-05` Respostas SIM/NÃO com correlação segura à reserva e atualização transacional de status.
- `F08-06` Lembretes configuráveis 24h/2h e recuperação 30/45/60 dias, respeitando consentimento e opt-out.
- `F08-07` Painel de envios, falhas, respostas e auditoria de permissões.

**Aceite:** teste com canal real autorizado, entrega/resposta rastreável; webhooks falsos, duplicados e fora de ordem não alteram incorretamente a agenda. Sem canal configurado, registrar como **bloqueado**, não simular entrega.

### Fase 09 — Site personalizável e mídia (P1; depende da 05)

- `F09-01` Identidade por empresa: logo, fotos, descrição, cores permitidas, endereço e slug/link público.
- `F09-02` Herdar Design System base e limitar personalização para preservar legibilidade, contraste e responsividade.
- `F09-03` Upload seguro via S3 ou mecanismo aprovado: tipo/tamanho, validação no servidor, permissões mínimas, URLs assinadas para recursos privados, exclusão autorizada.
- `F09-04` Metadados, SEO básico e página pública sem vazamento de cadastro financeiro/clientes.

**Aceite:** duas empresas exibem marcas e dados diferentes sem vazamento; uploads inválidos e não autorizados são negados.

### Fase 10 — Google Calendar (P2; depende das fases 04 e 06)

- `F10-01` Login Google não implica acesso automático ao Calendar: solicitar escopos separados com consentimento.
- `F10-02` Vincular calendário individual por profissional; tokens restritos a armazenamento servidor.
- `F10-03` Sincronizar criação, alteração e cancelamento com mapeamento de IDs e idempotência.
- `F10-04` Definir e testar política para eventos externos, conflitos, falhas temporárias e remoção do vínculo.

**Aceite:** sincronização demonstrada com calendário real de teste; falhas de API não corrompem a reserva original.

### Fase 11 — Planos e assinaturas SaaS (P2; depende das fases 02 e 07)

- `F11-01` Definir catálogo de planos, limites de profissionais/empresas e regras de períodos de teste.
- `F11-02` Selecionar e aprovar um provedor de cobrança real; separar assinatura da empresa de pagamentos dos serviços de barbearia.
- `F11-03` Integrar checkout e webhooks de cobrança seguros e idempotentes.
- `F11-04` Controlar estados de assinatura, renovação, falha, inadimplência, suspensão e reativação com políticas explícitas.
- `F11-05` Medir limites no servidor; impedir bypass pelo cliente e testar downgrade.

**Aceite:** plano controla recursos por empresa; cobrança real só ativada com aprovação de provedor, credenciais e ambiente.

### Fase 12 — Qualidade final, operação e publicação (P1; depende dos módulos incluídos no release)

- `F12-01` Revisão de segurança com `security-audit`; corrigir riscos reproduzidos, não tratar ferramenta como garantia absoluta.
- `F12-02` Revisão visual fiel ao `Design Sytem.md` em desktop/mobile, incluindo foco, teclado, contraste e estados vazios.
- `F12-03` Executar unit, integração, pgTAP, E2E, typecheck, lint e build.
- `F12-04` Revisar logs com minimização de dados, backup/restauração, rotação de segredos e runbook de incidentes.
- `F12-05` Preparar Vercel, domínios, redirect OAuth, ambientes e variáveis publicáveis/privadas.
- `F12-06` Documentar setup local, decisões pendentes, limitações e checklist de release.

**Aceite:** evidências de testes + revisão de segurança + fluxo completo em ambiente de teste. **Deploy somente após autorização explícita**.

## 8. Modelo inicial de dados — a refinar antes da primeira migration

| Domínio | Tabelas/estruturas candidatas |
|---|---|
| Identidade | `profiles`, `barbershops`, `memberships`, `invites` |
| Catálogo | `professionals`, `services`, `professional_services` |
| Agenda | `working_hours`, `schedule_exceptions`, `calendar_occupancies`, `bookings`, `booking_events` |
| Clientes | `customers`, `customer_identities`, `customer_consents` |
| Finanças | `payments`, `refunds`, `commissions`, `payouts`, `financial_ledger` |
| Automações | `integration_accounts`, `outbox_events`, `inbound_webhook_events`, `notification_logs` |
| Complementares | `media_objects`, `calendar_connections`, `calendar_event_links`, `plans`, `subscriptions`, `audit_logs` |

**Regras para toda migration:** chaves e constraints coerentes entre empresa/profissional/reserva; RLS onde a tabela for exposta, grants mínimos, índices de `barbershop_id`, usuário e datas consultadas; triggers e funções com privilégios estritos; SQL reproduzível e reversível quando tecnicamente seguro. **Nenhuma migration remota** sem autorização. Nunca realizar operações destrutivas em dados reais.

## 9. Matriz obrigatória de testes

| ID | Cenário | Resultado esperado |
|---|---|---|
| `T01` | Cliente acessa painel administrativo | 403/negação verificável |
| `T02` | Barbeiro tenta ler outro barbeiro | Acesso negado, exceto permissão explícita |
| `T03` | Empresa A tenta consultar/modificar B | Nenhum dado ou alteração cruzada |
| `T04` | Usuário altera payload/metadata para virar dono | Elevação rejeitada |
| `T05` | Dez reservas simultâneas no mesmo horário | Exatamente uma reserva ativa |
| `T06` | Dois profissionais no mesmo intervalo | Ambas permitidas |
| `T07` | Reservas consecutivas no mesmo profissional | Ambas permitidas sem sobreposição |
| `T08` | Folga, almoço e bloqueios versus reserva | Conflito rejeitado em ambos os sentidos |
| `T09` | Reagendar/cancelar e reservar no mesmo instante | Estado e ocupação consistentes |
| `T10` | Mudança do preço/duração do catálogo | Reservas antigas preservadas |
| `T11` | Timezone IANA, virada de dia e DST | Horários corretos e instantes não ambíguos |
| `T12` | Mais de três reservas futuras ativas | Quarta bloqueada atomicamente |
| `T13` | Chamadas sem JWT ou permissão em funções | Acesso negado |
| `T14` | Pagamento/repasse concorrente e retry | Um lançamento efetivo |
| `T15` | Upload malicioso, grande ou sem vínculo | Rejeitado |
| `T16` | Webhook falso, duplicado e fora de ordem | Não altera estado indevidamente |
| `T17` | Cancelamento de terceiro via telefone informado | Acesso negado |
| `T18` | Opt-out de marketing | Nenhum novo envio promocional |
| `T19` | Agendamento completo no navegador mobile/desktop | Fluxo concluído, layout fiel |
| `T20` | Logout/sessão expirada | Acesso protegido bloqueado |

**Prova de conclusão:** registrar comando executado, ambiente (local/teste), resultado, evidência de falha/sucesso e arquivo alterado. Não marcar testes como aprovados só por build compilar, skill carregar ou haver arquivos no diretório.

## 10. Regras de segurança e operação

1. Preservar `.env`, `Segurança.md`, `Design Sytem.md` e dados existentes; nunca expor segredos em logs, respostas, commits ou screenshots.
2. Usar somente a chave Supabase publicável no navegador; chaves privilegiadas exclusivamente em servidor protegido. Confirmar projeto `hbkbdqctelembzqiptpi` antes de qualquer conexão relevante.
3. Não confiar em `barbershop_id`, `role`, `user_id`, preço, comissão, duração nem status enviados pelo cliente: verificar e derivar do servidor/banco.
4. RLS **e** privilégios/grants SQL para tabelas expostas, políticas separadas por operação e teste de negativas. Views, funções privilegiadas e storage também exigem revisão.
5. Rate limiting e validação de entradas em operações públicas/sensíveis; proteção contra enumeração e abuso de slots; mensagens de erro sem detalhes internos.
6. Operações distribuídas críticas exigem transação PostgreSQL real, não várias chamadas HTTP independentes.
7. Webhooks e integrações precisam verificar assinatura, destinatário, event ID e replay; n8n não recebe chave privilegiada irrestrita.
8. Consentimentos e comunicação conforme finalidade, retenção mínima, direito de opt-out e cuidados LGPD; validar política jurídica antes de produção.
9. Não modificar design durante correção de segurança nem executar testes destrutivos em produção.
10. Não fazer commit, push, deploy, criação de serviços pagos nem migrations remotas sem autorização específica.
11. Máximo de três tentativas para erro repetido; registrar impedimento técnico e continuar tarefas independentes.
12. Skills e plugins ajudam, mas **não substituem testes**. A presença da pasta ou do plugin não comprova resultado.

## 11. Riscos, bloqueios e decisões explícitas

| Item | Risco | Conduta |
|---|---|---|
| Arquivos de design/segurança não lidos | Implementação divergente | **Bloquear código relacionado** até leitura integral |
| Google OAuth externo não configurado | Login indisponível | Implementar e registrar passos externos; não simular login real |
| `.env` aponta para outro Supabase | Alterar banco errado | Não executar conexão/migration; continuar UI offline |
| Reserva concorrente | Horário duplicado | Constraint e transação antes da UI final |
| Cliente apenas informa WhatsApp | Identidade não comprovada | MVP com sessão autenticada; liberar convidado só com verificação segura |
| WhatsApp Business/n8n sem credenciais | Mensagens não enviadas | Outbox pronta, integração marcada bloqueada |
| Pagamentos ainda sem provedor definido | Confundir registro com liquidação | Pagamento manual explicitado; cobrar só com integração autorizada |
| Google Calendar bidirecional | Conflitos de fonte de verdade | Definir estratégia antes de habilitar entrada de eventos |
| Plugin/skill com alerta de risco | Código externo inseguro | Revisar artefato completo antes de executar scripts |
| Assinaturas e valores dos planos | Cobrança incorreta | Decisão de negócio antes de ativar cobrança real |

**Pontos a decidir antes de cada fase afetada:** política de cancelamento/reagendamento; se haverá reservas por visitantes sem Google (e como verificar número); regras de comissões, custos e estornos; provedor de WhatsApp e modelo de consentimento; provedor de assinaturas, planos e preços; política de sincronização de Google Calendar; retenção de dados. Decisões técnicas rotineiras podem ser tomadas pela equipe e registradas; decisões de dinheiro, segurança, privacidade e conta externa não devem ser presumidas.

## 12. Gestão de tarefas e critérios de aceite

Criar `CHECKLIST.md` contendo para cada item:

```md
- [ ] F04-03 — Criar reserva transacional
  - Prioridade: P0
  - Dependências: F02-06, F03-05, F04-01
  - Arquivos: [preencher após implementação]
  - Critérios de aceite: sem sobreposição; autorização validada; resultado estável sob concorrência
  - Testes: T03, T05, T06, T07, T08, T12, T13
  - Evidências: [comandos/saídas/ambiente]
  - Bloqueios: nenhum | [motivo]
```

- **P0:** necessário para o primeiro agendamento seguro e funcional.
- **P1:** operação profissional e integrações úteis após o núcleo.
- **P2:** expansão SaaS e integrações não essenciais ao MVP.
- **Definição de pronto:** código implementado; autorização e regras validadas; testes relevantes aprovados; regressões verificadas; documentação e checklist atualizados; nenhum segredo exposto; sem mudança de design não solicitada.
- **Marcos:** `M0` documentos/ambiente; `M1` fundação; `M2` autenticação multiempresa; `M3` motor de agenda seguro; `M4` cliente agenda/cancela/reagenda; `M5` painéis; `M6` financeiro; `M7` integrações; `M8` SaaS e release. **M4 é o MVP prioritário**.

## 13. Formato do relatório de cada sessão

Informar objetivamente:

1. **Tarefa e fase atual:** ID e descrição.
2. **Implementado:** arquivos alterados e mudanças comprováveis.
3. **Testado:** testes e comandos executados, aprovados/reprovados.
4. **Segurança:** permissão/constraint/RLS verificada ou risco pendente.
5. **Bloqueios:** dependências externas, sem mascarar falhas.
6. **CHECKLIST:** itens `[x]`, `[~]`, `[!]`, `[ ]` conforme evidência.
7. **Próxima tarefa independente e autorizada.**

**Ordem de início:** ler os três documentos → atualizar checklist → executar F00 → F01 → F02 → F03 → F04 → F05. Não saltar diretamente para WhatsApp, cobrança ou telas bonitas enquanto o motor de agenda e o isolamento de empresas não estiverem comprovados.
