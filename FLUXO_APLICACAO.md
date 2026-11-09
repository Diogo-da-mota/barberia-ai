# Barberia AI — Fluxo Completo da Aplicação

Documento objetivo descrevendo cada página, o que executa, como funciona, tratamento de erros, modais, botões, abas e navegação.

---

## 1. AUTENTICAÇÃO E ENTRADA

### 1.1 Landing Page (`/`)
**Rota:** `/` (pública)  
**Arquivo:** `src/features/landing/pages/Landing.tsx`

**O que executa:**
- Página de vendas/institucional com hero, benefícios, passos do agendamento, perguntas frequentes
- Header fixo com navegação por âncoras (#beneficios, #como-funciona, #plataforma, #perguntas)
- Botão "Criar conta" (sem sessão) / "Abrir painel" (com sessão)
- Menu mobile (Sheet) com os mesmos links + botão Criar conta

**Autenticação:**
- Popup `AuthDialog` controlado por `?auth=` na URL (`entrar`, `criar-conta`, `recuperar`)
- Após login bem-sucedido: redireciona para `next` (state da navegação) ou `/dashboard`
- Sessão rejeitada pelo servidor mostra aviso "Sua conta não tem acesso a esta área"

**Estados de erro:**
- `?erro=email_not_confirmed` → "Confirme seu e-mail antes de entrar"
- `?erro=access_denied` → "Acesso negado. Verifique se sua conta tem permissão."
- Sessão rejeitada → aviso fixo no popup

**Componentes de demo:** `PublicPageDemo`, `WorkingHoursDemo`, `ConflictDemo`, `RolesDemo`, `ChooseServiceDemo`, `ChooseTimeDemo`, `ConfirmDemo`, `AppFrameDemo`, `HeroCollage`

---

### 1.2 Login Redirect (`/login`)
**Rota:** `/login` → redireciona para `/?auth=entrar`  
**Arquivo:** `src/routes.tsx` (função `LoginRedirect`)

---

### 1.3 Auth Callback (`/auth/callback`)
**Rota:** `/auth/callback` (pública)  
**Arquivo:** `src/features/auth/pages/AuthCallback.tsx`

**O que executa:**
- Processa retorno de OAuth (Google), confirmação de e-mail, recuperação de senha
- Lê parâmetros da URL (`type`, `error`, `next`)
- Redireciona para `next` ou `/` após processar

---

### 1.4 AuthDialog (Compartilhado)
**Arquivo:** `src/features/auth/components/AuthDialog.tsx` + `AuthForms.tsx`

**Funcionamento:**
- Abre via `?auth=` na URL (Landing, PublicShop, ClientBookings, AcceptInvite)
- Views: `entrar` (email/senha + Google), `criar-conta`, `recuperar`
- Troca de view mantém `next` e estado de redirecionamento
- Fecha limpando `?auth=` da URL
- Google OAuth: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: ... } })`

**Campos:**
- Entrar: email, senha, checkbox "Lembrar", botão "Entrar com Google", link "Esqueci a senha"
- Criar conta: nome, email, senha, confirmar senha, botão "Criar com Google"
- Recuperar: email, botão "Enviar link de recuperação"

**Erros tratados:**
- Credenciais inválidas, email não confirmado, senha fraca, email já cadastrado
- Toast de erro via `sonner`

---

### 1.5 AuthGuard (Proteção de Rotas Privadas)
**Arquivo:** `src/features/auth/components/AuthGuard.tsx`

**Funcionamento:**
- Wrapper que exige sessão válida (`useAuth()`)
- Se não há sessão: abre `AuthDialog` com `view="entrar"` e `next` = rota atual
- `loginPath` customizável (padrão: `/?auth=entrar`)
- Evita ciclo: sessão recusada pelo servidor não redireciona

---

## 2. ÁREA PÚBLICA DA BARBEARIA (CLIENTE FINAL)

### 2.1 Página Pública da Barbearia (`/:slug`)
**Rota:** `/:slug` (pública)  
**Arquivo:** `src/features/booking/pages/PublicShop.tsx`

**O que executa:**
- Carrega dados da barbearia via `getPublicShop(slug)` (nome, serviços, profissionais, galeria, cor, template, fuso)
- Aplica SEO dinâmico (`applySeo`)
- Renderiza template escolhido (`SiteRenderer` com 5 templates: Urbano, Clássico, Minimalista, Moderno, Premium)
- Mesma lógica de reserva para todos os templates (componentes abaixo do template)

**Fluxo de Reserva (3 etapas no `BookingDialog`):**
1. **Escolha do profissional** → `ProfessionalChoice` (cards com foto, "Qualquer profissional disponível" + lista)
2. **Escolha do dia/horário** → `SlotPicker` (Calendar shadcn + horários de `get_availability`)
3. **Dados do cliente** → nome, WhatsApp (`PhoneInput`), checkboxes lembretes + marketing, botão "Confirmar reserva"

**Estados:**
- `draft` em `sessionStorage` (`barberia:booking-draft`) persiste entre login
- Se não logado ao confirmar: salva draft, fecha reserva, abre `AuthDialog`; ao voltar, reabre com dados
- Key única (`crypto.randomUUID()`) evita reserva duplicada

**Erros:**
- Horário ocupado → recarrega slots, mostra erro no passo 3
- Validação contato (nome + WhatsApp) → erros inline
- Migration faltando (`isMissingSchema`) → "Esta página ainda está sendo preparada"
- Barbearia não encontrada → `EmptyState` com botão "Voltar ao início"
- Loading → Skeletons

**Seções com URL própria (sem #):**
- `/:slug/servicos`, `/:slug/profissionais`, `/:slug/galeria`, `/:slug/contato` → rola até a seção via `scrollIntoView`

**Headers:** `PublicHeader` (marca da barbearia, botão "Acesso" → `/:slug/minhas-reservas`)

---

### 2.2 Minhas Reservas por Barbearia (`/:slug/minhas-reservas`)
**Rota:** `/:slug/minhas-reservas` (pública, ver reservas exige login)  
**Arquivo:** `src/features/booking/pages/ClientBookings.tsx`

**Layout:** Próprio (`ClientHeader` + coluna lateral + main), **sem Shell/sidebar**

**O que executa:**
- Carrega barbearia (`getPublicShop`)
- Aplica cor da barbearia (`useShopAccent`)
- Template da barbearia para paleta
- **Sem login:** mostra `ClientLogin` (panel com título "Acesso — {nome}", botões Entrar/Criar conta)
- **Com login:** `AuthGuard` → `ClientArea`

**ClientArea (logado):**
- Hook `useReservations(slug)` → busca reservas, separa `upcoming` (ativas) e `history` (passadas)
- Coluna lateral (desktop ≥1024px): foto decorativa (galeria/capa), resumo com contadores, botão "Nova reserva"
- Mobile/tablet: faixa compacta no topo com contadores + botão
- Cards: `ClientReservationCard` (foto do serviço cadastrado, ações: Reagendar / Cancelar)
- Dialogs de confirmação (`askMove`, `askCancel`) vêm do hook

**Erros:**
- Migration faltando → "Reservas indisponíveis"
- Erro de carga → botão "Tentar novamente"
- Loading → Skeletons
- Sem reservas → `EmptyState` com "Agendar um horário"

**Navegação:** Botão "Nova reserva" → `/:slug` (página pública)

---

### 2.3 Acesso Neutro (`/acesso`)
**Rota:** `/acesso` (pública)  
**Arquivo:** `src/features/booking/pages/ClientBookings.tsx` → `ClientAccess()`

**O que executa:**
- `PublicHeader` sem nome de barbearia
- `ClientLogin` com `next="/minhas-reservas"`
- Texto: "Para agendar, abra a página da sua barbearia."

---

### 2.4 Minhas Reservas Global (`/minhas-reservas`)
**Rota:** `/minhas-reservas` (exige sessão)  
**Arquivo:** `src/features/booking/pages/MyBookings.tsx`

**Layout:** Usa `Shell` (sidebar + header do painel)

**O que executa:**
- `AuthGuard` com `loginPath` = `/acesso` (ou última barbearia visitada via `lastShop.ts`)
- Lista reservas de **todas** as barbearias do cliente
- Mesmo `ClientReservationCard` mas agrupado por barbearia
- Filtros: Próximas / Histórico

---

### 2.5 Convite de Equipe (`/convite?token=`)
**Rota:** `/convite` (pública, aceitar exige login)  
**Arquivo:** `src/features/booking/pages/AcceptInvite.tsx`

**O que executa:**
- Lê `token` da query string
- Sem token → `EmptyState` "Link de convite incompleto"
- Com token + sessão → botão "Aceitar convite" → `acceptInvite(token)` → invalida `my-barbershops` → `/dashboard`
- Sem sessão → botão "Entrar para aceitar" → abre `AuthDialog` → após login, aceita automaticamente

---

## 3. PAINEL DA EQUIPE (DASHBOARD)

### 3.1 Shell (Layout Base)
**Arquivo:** `src/app/Shell.tsx`

**Estrutura fixa (`relative h-dvh overflow-hidden`):**
- **Sidebar (256px lg, 64px md):** ícones apenas 768-1023px, completa ≥1024px
  - Foto vertical `painel-menu.jpg` abaixo de "Mais" (só tema escuro)
  - Itens variam por papel (ver 3.2)
  - Botões: Tema (claro/escuro), Sair
- **Header:** nome da barbearia ativa + botão "Ver site" (nova aba), avatar + nome (link → `/dashboard/mais`)
- **Main:** único que rola (`overflow-y-auto`, `overscroll-contain`)
- **Mobile menu (Sheet):** mesma lista da sidebar
- **Bottom nav (≤767px):** 5 destinos fixos (Início, Agenda, Serviços, Equipe, Mais)

**Props:** `hero?: string` (foto atrás do header, ex: `painel-topo.jpg` no Home)

---

### 3.2 Roteamento do Dashboard (`/dashboard/*`)
**Arquivo:** `src/routes.tsx`

**Proteção:** `AuthGuard` → `StaffRoute` (verifica se não é `isCustomerOnly`)

**Menu por papel:**
| Papel | Itens da Sidebar |
|-------|------------------|
| Proprietário/Gerente | Início, Agendamentos, Clientes, Serviços, Equipe, Financeiro, Mensagens, Meu site, Mais |
| Barbeiro | Início, Agendamentos, Clientes, Serviços, Equipe, Mais |
| Sem barbearia ativa | Início, Minhas reservas, Mais |
| Cliente apenas | Redirecionado para `/minhas-reservas` |

**Rota `/dashboard/horarios`** → redireciona para `/dashboard/equipe` (horários agora na edição do profissional)

---

### 3.3 Home / Início (`/dashboard`)
**Arquivo:** `src/features/home/pages/Home.tsx` + `HomeView.tsx`

**Dados (Home):**
- `fetchMyBarbershops` → lista barbearias do usuário
- Identifica `manager` (papel ≠ cliente) → define fuso horário
- Se gestão: `fetchShopBookings` (reservas da barbearia), `fetchShopHours`, `fetchReport` (recebido no mês)
- Se não gestão: `fetchMyBookings` (próprias reservas)
- `computeStats` (hoje/semana/comparecimento), `computeOccupancy` (só gestão)

**Visual (HomeView):**
- `Shell hero="/images/painel-topo.jpg"`
- Saudação + data formatada
- `StatCards` (gestão: atendimentos hoje/semana, comparecimento, ocupação %, recebido mês) + `BarbershopList` (cards das barbearias)
- `QuickActions` (gestão: "Nova reserva", "Ver site", "Novo serviço", "Novo profissional")
- `AgendaBoard` (lista do dia, clicável para filtrar)
- `MiniCalendar` (lateral, só gestão, seleciona dia no AgendaBoard)

**Barbeiro/Cliente:** vê só saudação + `BarbershopList` + `AgendaBoard` (próprias reservas)

---

### 3.4 Agendamentos (`/dashboard/agendamentos`)
**Arquivo:** `src/features/booking/pages/Agenda.tsx` → `DayAgenda`

**Acesso:** Gestão + Barbeiro (readOnly=true para barbeiro)

**Visões (tabs):** Dia / Semana / Mês (botões toggle)

**Navegação:** Botões Anterior/Hoje/Próximo (unidade = dia/semana/mês)

**Lista (Dia):**
- Merge de `fetchShopBookings` + `fetchBlocks` → rows ordenados por horário
- `ReservationCard` unificado:
  - Reserva: foto do profissional, serviço + badge status, horário, cliente/profissional/duração/preço, link WhatsApp
  - Ações (gestão): Concluir/Faltou (se confirmado e horário passou), Cancelar
  - Ações (barbeiro): só Concluir/Faltou
  - Bloqueio: ícone cadeado, botão "Remover" (só gestão)

**Semana:** 7 sections (um por dia) com contagem + lista
**Mês:** Grid 7 colunas, badges de contagem, clique → vai para Dia

**Bloquear horário (gestão):**
- Botão "Bloquear horário" → `BlockDialog`
- Form: profissional (radio), início/fim (`DateTimeField`), motivo (opcional)
- `createBlock` → invalida queries + toast

**Cancelar reserva:** `ConfirmDelete` dialog → `cancelBooking` → invalida

**Erros:** Migration faltando → "Agenda indisponível", erro carga → "Tentar novamente", loading → Skeletons

---

### 3.5 Clientes (`/dashboard/clientes`)
**Arquivo:** `src/features/booking/pages/Customers.tsx`

**Acesso:** Equipe (gestão + barbeiro)

**O que executa:**
- `fetchCustomers` (derivado das reservas)
- Lista com busca, paginação
- Card: nome, telefone, email, total de reservas, última visita, tags (novo/recorrente)
- Clique → detalhes (histórico de reservas daquela barbearia)

---

### 3.6 Serviços (`/dashboard/servicos`)
**Arquivo:** `src/features/catalog/pages/Services.tsx` → `ServiceList`

**Acesso:** Equipe lê; Gestão edita

**Dados:**
- `fetchServices` (lista)
- `fetchServiceSales` (vendas reais, só gestão) → `salesByService`, `topSellers`, `averageTicket` (90 dias, mín. 3 atendimentos concluídos)

**UI:**
- `ServiceStats` (ativos, total, ticket médio) — só gestão
- Filtro chips: "Todos (N)" / "Mais vendidos (N)" (só gestão, persiste ao editar)
- Grid de `ServiceCard` (variant="painel"): foto principal + carrossel (setas, arraste, pontinhos), nome, preço, duração, badge "Mais vendido" (se em `topSellers`)
- Ações (gestão): Editar (lápis), Excluir (lixeira)
- Botão "Novo serviço" → `ServiceDialog`

**ServiceDialog:**
- Abas: Básico (nome, descrição, preço centavos `MoneyInput`, duração min, ativo), Fotos (até 5, upload direto, carrossel), Equipe (checkboxes profissionais que atendem)
- Preço: `MoneyInput` (digitação direita→esquerda, formato 00,00, trafega centavos)
- Fotos: upload imediato, `publicMediaUrl` para preview

**Excluir:** `ConfirmDelete` → `deleteService` → invalida services + professionals

**Erros:** Migration faltando → "Catálogo indisponível"

---

### 3.7 Equipe (`/dashboard/equipe`)
**Arquivo:** `src/features/catalog/pages/Team.tsx` → `TeamList`

**Acesso:** Equipe lê; Gestão edita

**Dados:**
- `fetchProfessionals`, `fetchServices` (para nomes dos serviços), `fetchBarbers` (perfis de auth, só gestão), `fetchTeamLinks` (vínculo auth↔profissional), `fetchProfessionalContacts` (telefone/email/documento, só gestão)

**UI:**
- Cards `ProfessionalCard`: foto quadrada arredondada, nome, serviços (badges), telefone/email (só gestão)
- Ações (gestão): Editar, Excluir
- Botões header: "Gerar link do convite" (abre `InviteDialog` popup) + "Novo profissional"

**InviteDialog (popup):**
- Gera link `/convite?token=` válido por 7 dias
- Apenas gerente/proprietário convida; convida só barbeiro (papel fixo)
- Copia link, fecha

**ProfessionalDialog (editar/novo):**
- Abas: Dados (nome, ativo, serviços checkbox), Horários (jornada semanal: dia, início, fim, pausa início/fim, folga), Conta (vincular usuário auth existente, só gestão), Contato (telefone, email, CPF/CNPJ — só gestão vê/edit)
- Horários: grid 7 dias, cada dia pode ter múltiplos turnos
- Foto: `ProfessionalAvatar` (upload + crop quadrado)

**Excluir:** `ConfirmDelete` → `deleteProfessional`

**Erros:** Migration faltando → "Equipe indisponível"

---

### 3.8 Financeiro (`/dashboard/financeiro`)
**Arquivo:** `src/features/finance/pages/Finance.tsx` → `ManagerView` / `MyEarnings`

**Acesso:** Gestão (abas completas) / Barbeiro (só "Meus ganhos")

**Header (`FinanceHeader`):**
- Tabs: Resumo, Pagamentos, Comissões, Repasses, Custos
- Seletor de mês (só Resumo e Custos)
- Foto faixa (`PageBanner financeiro`)

**Gestão - Abas:**

| Aba | Conteúdo |
|-----|----------|
| **Resumo** | Indicadores (recebido confirmado, a receber, a declarar, ticket médio), evolução mensal (gráfico), origem dos valores, movimentações recentes |
| **Pagamentos** | Busca + filtros (status, forma, período), lista pagamentos, ações: Confirmar (`confirm_payment`), Descartar (`discard_payment`), Estornar (só confirmado) |
| **Comissões** | Valores por profissional (provisionada/liquidada/cancelada), regras de comissão (% ou fixo), selo "Mais vendido" nos serviços |
| **Repasses** | Seção dentro de Comissões: lista repasses, valores, status, data |
| **Custos** | Lançamentos de custo, total do mês, seletor de mês |

**Domínio financeiro (`features/finance/domain.ts`):**
- `confirmedTotal` / `pendingTotal` / `remainingToReceive` / `remainingToDeclare`
- `register_payment` cria **a confirmar** (não soma em Recebido)
- `confirm_payment` (gestão) lança no caixa
- `discard_payment` descarta não confirmado
- Estorno só do confirmado
- Reserva com pagamento (confirmado ou a confirmar) **não cancela**

**Barbeiro (`MyEarnings`):**
- Cards: "A receber" (provisionada), "Já repassado" (liquidada)
- Lista `CommissionList` (suas comissões + repasses recebidos)

**Erros:** Migration faltando → "Financeiro indisponível"

---

### 3.9 Mensagens (`/dashboard/mensagens`)
**Arquivo:** `src/features/messaging/pages/Messages.tsx` → `Panels` + `NotificationsPanel`

**Acesso:** Só Gestão

**Tabs (URL `?aba=`):**
1. **Mensagens** (fila de envios WhatsApp)
2. **Notificações** (configuração de templates automáticos)

**Aba Mensagens:**
- `WhatsAppStatus` (faixa: estado real da conexão — Verificando/Conectar/Conectado/Desconectar)
- `MessageStats` (cards: pendentes, enviadas, falharam, recebidas)
- `StatusFilters` (chips: Todas, Pendentes, Enviadas, Falharam)
- Lista `MessageRow`: tipo (confirmação/lembrete), cliente, horário, status, resposta (SIM/NÃO)
- **Desktop (≥1280px):** painel lateral direito com `MessageDetail` / `MessageInfo`
- **Tablet/Mobile:** popup `MessageBookingDialog` ao clicar
- `ReplyList` (respostas recebidas: SIM confirma, NÃO cancela)
- Ações no detalhe: Reagendar, Pagamento, Cancelar (abrem dialogs)
- `DeleteMessageDialog` (apaga mensagem + registros de envio; reserva/financeiro intactos)

**Aba Notificações (`NotificationsPanel`):**
- Templates editáveis: `msg_confirmacao`, `msg_lembrete` (variáveis: `{{cliente}}`, `{{servico}}`, `{{profissional}}`, `{{data}}`, `{{hora}}`, `{{link}}`)
- Preview ao vivo
- Canais: WhatsApp (estado real), SMS, Email
- Consentimento de novidades (marketing)
- `ReminderConfigCard` (quando enviar lembrete: 24h, 2h, etc.)
- `ReturnMessageCard` (configuração de retorno de cliente inativo — migration 0020)

**Estado WhatsApp (`whatsappState`):** Definição única para as duas abas, cache `whatsapp-status`

**Erros:** Migration faltando → "Mensagens indisponíveis"

---

### 3.10 Meu Site (`/dashboard/site`)
**Arquivo:** `src/features/site/pages/SiteSettings.tsx` → `Editor` + `Workspace`

**Acesso:** Só Gestão

**Layout:** Grid 2 colunas (esquerda: editor, direita: galeria templates + prévia)

**Editor (esquerda) — Blocos:**
1. **Template:** Seleção visual (5 cards), mostra "Selecionado, não salvo" se mudou. Migration 0011 necessária para salvar.
2. **Marca:** Logo + Capa (tiles clicáveis)
   - Clique na imagem → abre ajuste embutido (`Cropper` inline) com formato do template (`slots.ts`)
   - Lápis → troca arquivo (abre crop)
   - Lixeira → remove
   - Previa muda ao vivo durante crop (`live.logo` / `live.capa`)
3. **Galeria:** Grid 4 colunas, até 5 fotos, upload direto, lixeira
4. **Cores:** `AccentPicker` (bolinhas) — clicar troca na hora prévia + painel + salva `cor_destaque` da barbearia
5. **Endereço do site:** Input slug (só proprietário), validação regex, check disponibilidade (debounce 400ms), botão copiar link
6. **Botão único "Salvar alterações"** (template + descrição + endereço). Imagens e cor gravam na hora.

**Prévia (direita):**
- `TemplateGallery`: 5 miniaturas reais (`thumbView` = dados salvos, não mexe no crop)
- `SitePreview`: prévia grande responsiva (desktop/tablet/celular via `@container` queries), mostra `unsaved` badge se template/descrição mudaram
- `ScaledFrame`: iframe simulado com zoom

**Templates (5):** `UrbanoTemplate`, `ClassicoTemplate`, `MinimalistaTemplate`, `ModernoTemplate`, `PremiumTemplate` — todos consomem `SiteView` (contrato único)

**Erros:** Migration 0011 faltando → aviso "A troca de template só pode ser salva depois que a migration 0011 for aplicada"

---

### 3.11 Mais (`/dashboard/mais`)
**Arquivo:** `src/features/booking/pages/More.tsx`

**Acesso:** Sessão (versão varia por papel)

**Gestão (2 abas `?aba=`):**
1. **Dados da barbearia** (`ShopDataTab`):
   - Info: nome, descrição, fuso, status (ativo/inativo)
   - Endereço: CEP (ViaCEP), rua, número, complemento, bairro, cidade, UF
   - Dados fiscais (só proprietário): CPF/CN PJ, IE, IM, regime tributário
   - Plano + Google Calendar (coluna direita, `PlanCard` + `CalendarCard`)
   - **Dois cards lado a lado:**
     - Contato comercial: WhatsApp + Email comercial (salvamento único)
     - Integração WhatsApp: `WhatsAppConnect` + `useWhatsAppConnection` (mesmo de Mensagens › Notificações)
       - "Verificando conexão…" → "Conectar WhatsApp" (vermelho, abre QR Evolution) → consulta 3s / renova QR 30s → "Conectado" + botão "Desconectar" (verde)
2. **Documentos** (`DocumentsTab`): Bucket privado, só proprietário, link assinado 60s

**Redirecionamentos de abas antigas:**
- `?aba=notificacoes` → `/dashboard/mensagens?aba=notificacoes`
- `?aba=horario` → `/dashboard/equipe`
- `?aba=whatsapp` → `/dashboard/mais?aba=dados`

**Equipe sem gestão / Cliente:**
- `ShopSummary` (nome, papel, endereço)
- `CalendarCard` (Google Calendar, se barbeiro)
- `AppearanceCard` (seletor cor de destaque do usuário)
- `PreferencesCard` (consentimento novidades)

**Sem barbearia:** `EmptyState` "Você ainda não tem barbearia" + botão "Criar barbearia" → `/dashboard/barbearias/nova`

---

### 3.12 Nova Barbearia (`/dashboard/barbearias/nova`)
**Arquivo:** `src/features/barbershops/pages/CreateBarbershop.tsx`

**O que executa:** Formulário de criação (nome, slug, fuso, dono) → cria barbearia + vincula proprietário → redireciona para `/dashboard`

---

## 4. COMPONENTES TRANSVERSAIS E PADRÕES

### 4.1 Dinheiro (`MoneyInput`, `formatPrice`)
**Arquivos:** `src/ui/finance.tsx`, `src/lib/money.ts`
- Digitação direita→esquerda, formato `00,00` → `1.000,00`
- Trafega em centavos (inteiro)
- `formatPrice(centavos)` → "R$ 1.000,00"

### 4.2 Datas e Horários
**Arquivo:** `src/ui/date-time.tsx` (shadcn Popover + Calendar)
- `DateField`, `MonthField`, `TimeField`, `DateTimeField`
- **Nunca** `<input type="date|time|month|datetime-local">`
- Fuso da barbearia (`booking/domain.ts`); instantes em UTC

### 4.3 Listas Suspensas (`OptionSelect`)
**Arquivo:** `src/ui/option-select.tsx` (shadcn Select)
- Abre abaixo do campo, ícone opcional
- **Nunca** `<select>` nativo
- Forma pagamento: `PaymentFormSelect` com ícones (PIX, dinheiro, débito, crédito)

### 4.4 Cor de Destaque (Accent)
**Arquivos:** `src/lib/accent.ts`, `src/lib/appearance.tsx`, `src/ui/accent-picker.tsx`
- **Por USUÁRIO** na conta (`user_metadata.accent` via `saveAccentPreference`)
- Aplicada como `data-accent` no `<html>` por `AppearanceProvider`
- Visitante sem conta vê cor da barbearia (`cor_destaque`, `useShopAccent`)
- Em Meu Site: clique também grava `cor_destaque` da barbearia
- Valores em `accent.ts` + `index.css` (`html[data-accent="…"]`)
- **Nunca** aplicar via `style` em wrapper

### 4.5 Cards Únicos (Design System)
| Componente | Onde usado | Características |
|------------|------------|-----------------|
| `ReservationCard` | `/dashboard/agendamentos`, `/:slug/minhas-reservas` | Foto quadrada prof. à esquerda, dados centro, ações direita |
| `ClientReservationCard` | `/:slug/minhas-reservas` | Foto do **serviço** cadastrado, ações Reagendar/Cancelar |
| `ServiceCard` | Painel + página pública | Carrossel fotos (setas, arraste, pontinhos), até 5 fotos |
| `ProfessionalCard` / `ProfessionalPhoto` | Equipe, agendamentos | Foto quadrada arredondada à esquerda |
| `ProfessionalTag` | Listas compactas | Nome + foto minúscula |

### 4.6 Reserva Pública (BookingDialog)
**Arquivo:** `src/features/booking/components/BookingDialog.tsx`
- Modal (Dialog shadcn) com 3 Steps (ProfessionalChoice → SlotPicker → Dados)
- `SlotPicker`: Calendar shadcn + horários dinâmicos (`get_availability` RPC)
- Key única por abertura evita duplicação
- Draft em `sessionStorage` sobrevive a login

### 4.7 Layout do Painel (Não Quebrar)
- `Shell`: `relative h-dvh overflow-hidden` → sidebar/header fixos, só `main` rola
- **Obrigatório** `relative` (sem ele, inputs `absolute`/`sr-only` escapam e body rola)
- Nunca `min-h-dvh` nem rolagem do `body` dentro do painel
- Teste: `evidencias/execucao/todas-as-paginas.e2e.mjs.txt` (bloco "Layout fixo")

---

## 5. TRATAMENTO DE ERROS (Padrão Comum)

**Em todas as páginas com dados:**
```tsx
if (isMissingSchema(error)) 
  return <EmptyState title="Módulo indisponível" description="Ainda sendo preparado no banco." />

if (query.isError)
  return <div role="alert">Erro + Botão "Tentar novamente" (refetch) />

if (!query.data)
  return <Skeleton /> // loading
```

**Mutations:**
- `onSuccess`: invalida queries relacionadas + `toast.success`
- `onError`: `toast.error(bookingErrorMessage(error))` ou `setError` inline
- `ConfirmDelete` dialog antes de ações destrutivas

**RLS/Segurança:** Proteção real no banco (RLS + `private.has_role` / `private.is_member` / `private.is_my_professional`). Frontend apenas UX.

---

## 6. MIGRATIONS E BANCO (Resumo Operacional)

| Migration | Assunto | Status |
|-----------|---------|--------|
| 0001 | Identidade/RLS | Remoto |
| 0002 | Serviços/Equipe | Remoto |
| 0003 | Agenda/Reservas/Bloqueios | Remoto |
| 0004 | Agenda do barbeiro | Remoto |
| 0005 | Financeiro | Remoto |
| 0006 | Outbox/Inbox/WhatsApp | Remoto |
| 0007 | Site/Mídia | Remoto |
| 0008 | Planos | Remoto |
| 0009 | Google Calendar | Remoto |
| 0010 | Fotos do serviço (galeria 5) | Remoto |
| 0011 | Modelo do site (template, save_site_template) | **Aplicada remoto 2026-11-07** |
| 0012 | Dados barbearia (contato, endereço, fiscal) | **Pronta, aguarda aprovação** |
| 0013 | Documentos privados | **Pronta, aguarda aprovação** |
| 0017 | Lembretes (diff) | Remoto 2026-11-07 |
| 0018 | claim_whatsapp_outbox | Remoto 2026-11-07 |
| 0019 | Templates de mensagem (msg_confirmacao/lembrete) | Remoto 2026-11-07 |
| 0020 | Retorno de cliente (reativação) | Remoto 2026-11-07 |

**Regra:** Uma migration = um assunto. Editar aplicada → editar arquivo + aplicar só diff no remoto (com autorização). `supabase db query --remote --yes -f supabase/aplicar/XXX.sql`

---

## 7. FLUXOS PRINCIPAIS RESUMIDOS

### Cliente Final (Público)
1. Acessa `/:slug` → vê página com template da barbearia
2. Clica "Reservar" → `BookingDialog` (3 passos)
3. Se não logado → salva draft → `AuthDialog` → login → reabre dialog com dados
4. Confirma → `createBooking` (RPC com key única) → success → "Reserva confirmada" + link "Ver minhas reservas"
5. Acessa `/:slug/minhas-reservas` → login → vê `ClientBookings` (próximas/histórico, reagendar/cancelar)

### Equipe (Dashboard)
1. Acessa `/` → `AuthDialog` → login → `/dashboard`
2. `Home` → vê indicadores + agenda do dia + ações rápidas
3. `/dashboard/agendamentos` → gerencia agenda (dia/semana/mês), bloqueios, conclui/falta/cancela
4. `/dashboard/servicos` → CRUD serviços, vê vendas reais + "Mais vendido"
5. `/dashboard/equipe` → CRUD profissionais, horários na edição, convites
6. `/dashboard/financeiro` → gestão: 5 abas (resumo, pagamentos, comissões, repasses, custos) / barbeiro: meus ganhos
7. `/dashboard/mensagens` → 2 abas: fila WhatsApp + config notificações/templates
8. `/dashboard/site` → editor visual 5 templates, prévia responsiva, salvar único
9. `/dashboard/mais` → 2 abas: dados (info, endereço, fiscal, plano, GC, contato+WhatsApp) + documentos

---

## 8. PERMISSÕES POR ROTA (Resumo)

| Rota | Público | Cliente (logado) | Barbeiro | Gerente | Proprietário |
|------|---------|------------------|----------|---------|--------------|
| `/` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/:slug` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/:slug/minhas-reservas` | ✓ (ver) | ✓ (gerir) | ✓ | ✓ | ✓ |
| `/minhas-reservas` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `/acesso` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/convite?token=` | ✓ (aceitar) | ✓ | ✓ | ✓ | ✓ |
| `/dashboard` | ✗ | ✗ (→ minhas-reservas) | ✓ | ✓ | ✓ |
| `/dashboard/agendamentos` | ✗ | ✗ | ✓ (readOnly) | ✓ | ✓ |
| `/dashboard/servicos` | ✗ | ✗ | ✓ (ler) | ✓ | ✓ |
| `/dashboard/equipe` | ✗ | ✗ | ✓ (ler) | ✓ | ✓ |
| `/dashboard/financeiro` | ✗ | ✗ | ✓ (meus ganhos) | ✓ | ✓ |
| `/dashboard/mensagens` | ✗ | ✗ | ✗ | ✓ | ✓ |
| `/dashboard/site` | ✗ | ✗ | ✗ | ✓ | ✓ |
| `/dashboard/mais` | ✗ | ✓ (curta) | ✓ (curta) | ✓ | ✓ |
| `/dashboard/barbearias/nova` | ✗ | ✗ | ✗ | ✗ | ✓ |

---

*Documento gerado em 2026-11-08 baseado na análise do código-fonte (React 19 + Vite + TypeScript + Tailwind v4 + React Query + Supabase).*