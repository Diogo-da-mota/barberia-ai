# Barberia AI — Guia Completo (Linguagem Simples)

*Para apresentação a não-técnicos. Baseado no sistema real (React + Supabase).*

---

## SUMÁRIO RÁPIDO

| Área | Rotas | Quem Acessa |
|------|-------|-------------|
| **Público** | `/`, `/:slug`, `/:slug/minhas-reservas`, `/acesso`, `/convite`, `/minhas-reservas` | Todos (cliente agenda sem login; para ver reservas precisa entrar) |
| **Painel (Dashboard)** | `/dashboard/*` | Só equipe logada (barbeiro, gerente, dono). Cliente só vai para "Minhas reservas" |
| **Configurações** | `/dashboard/mais` | Todos logados (versão varia por papel) |

---

## 1. PÁGINAS PÚBLICAS (CLIENTE FINAL)

### Landing — Página Inicial do Sistema (`/`)

**Para que serve:** Apresenta o Barberia AI para novos usuários. Vitrine do produto.

**O que mostra:**
- Hero: "Agendamento online para barbearias" + botão **"Criar conta"**
- 4 benefícios com mini-demos: página pública, agenda por barbeiro, não aceita horário duplicado, dados separados por barbearia
- 3 passos do agendamento (escolhe serviço/profissional → dia/horário → confirma)
- Agenda do dia por profissional (demo visual)
- Perguntas frequentes (4 itens expansíveis)
- Rodapé com botão **"Criar conta"** grande

**Botões principais:**
- **Criar conta** → abre popup de cadastro (email/senha ou Google)
- **Entrar** (canto superior) → abre popup de login

**Popup de autenticação (`?auth=`):**
- Abas: **Entrar** / **Criar conta** / **Recuperar senha**
- Google: botão "Entrar com Google" / "Criar com Google"
- Após sucesso → vai para `/dashboard` (equipe) ou volta onde estava (cliente)

---

### Página da Barbearia (/:slug)

**Para que serve:** Site público de **uma barbearia específica**. Cada barbearia tem seu link (ex: `barberia.ai/joao-barbearia`).

**O que mostra:**
- Template visual escolhido no painel (5 opções: Urbano, Clássico, Minimalista, Moderno, Premium)
- Seções com rolagem suave (URLs próprias):
  - **Início** — capa, descrição, botão "Reservar"
  - **Serviços** — cards com foto, nome, preço, duração
  - **Profissionais** — cards com foto, nome, serviços que atende
  - **Galeria** — fotos do ambiente
  - **Contato** — endereço, WhatsApp, email, mapa
- Header: logo + nome da barbearia + botão **"Acesso"** (vai para `/:slug/minhas-reservas`)

**Botão "Reservar" → Abre agendamento em 3 passos (popup):**

| Passo | O que o cliente faz |
|-------|---------------------|
| **1. Profissional** | Escolhe "Qualquer um disponível" OU um barbeiro específico (vê foto + nome) |
| **2. Dia e horário** | Calendário mensal + horários livres (respeita jornada, almoço, folga, duração do serviço) |
| **3. Seus dados** | Nome, WhatsApp, ☑ "Quero lembretes", ☑ "Aceito promoções" → **Confirmar reserva** |

**Se não estiver logado ao confirmar:**
- Salva rascunho → abre popup de login → após entrar, reabre agendamento com dados preenchidos

**Após confirmar:** Tela "Reserva confirmada" + botão **"Ver minhas reservas"**

**Erros possíveis:**
- Horário acabou de ser ocupado → recarrega horários, avisa "Escolha outro"
- Barbearia não existe → "Confira o endereço ou fale com a barbearia"
- Sistema preparando → "Esta página ainda está sendo preparada"

---

### Minhas Reservas da Barbearia (/:slug/minhas-reservas)

**Para que serve:** Área do cliente **dessa barbearia**. Visual com a marca da casa (cor, template, fotos).

**Sem login:** Tela **"Acesso — [Nome da Barbearia]"** → botões **Entrar** / **Criar conta**

**Com login (layout em duas colunas no desktop):**

**Coluna lateral (esquerda):**
- Foto do ambiente (galeria ou capa)
- **Resumo:** Cards clicáveis → "Próximas reservas (X)" / "Histórico (Y)"
- Botão **"Nova reserva"** → volta para página pública (`/:slug`)

**Coluna principal (direita):**
- Cabeçalho: "Olá, [Primeiro nome]" + "Suas reservas"
- **Próximas** → cards com: foto do serviço, data/horário, profissional, botões **Reagendar** / **Cancelar reserva**
- **Histórico** → cards só leitura (atendimentos passados)

**Mobile:** Resumo vira faixa compacta no topo (sem coluna lateral)

**De onde vêm os dados:** Reservas feitas pelo cliente (público ou painel), filtradas por CPF/WhatsApp do usuário logado

---

### Minhas Reservas Global (/minhas-reservas)

**Para que serve:** Todas as reservas do cliente em **todas as barbearias** que já usou. Usa layout do painel (sidebar esquerda).

**Acesso:** Precisa login. Se não tem barbearia recente → redireciona para `/acesso`

**O que mostra:** Lista agrupada por barbearia, separada em **Próximas** e **Histórico**. Mesmo card visual da tela anterior.

---

### Acesso Neutro (/acesso)

**Para que serve:** Porta de entrada quando o cliente não sabe qual barbearia.

**O que mostra:**
- Header simples (sem nome de barbearia)
- Tela de login/criar conta com `next="/minhas-reservas"`
- Texto: **"Para agendar, abra a página da sua barbearia."**

---

### Convite de Equipe (/convite?token=)

**Para que serve:** Aceitar convite para trabalhar na barbearia.

**Fluxo:**
1. Link recebido por WhatsApp/email (ex: `barberia.ai/convite?token=abc123`)
2. **Já logado** → botão **"Aceitar convite"** → entra na equipe → vai para `/dashboard`
3. **Não logado** → botão **"Entrar para aceitar"** → login → aceita automaticamente
4. Token inválido/expirado → "Peça novo link ao proprietário ou gerente"

---

## 2. PAINEL DA EQUIPE (/dashboard/*)

### Layout Base (Shell)

**Estrutura fixa (não rola a página toda, só o meio):**
- **Sidebar esquerda** (ícones só 768-1023px, completa ≥1024px):
  - Foto vertical decorativa (só tema escuro)
  - Menu conforme papel (ver tabela abaixo)
  - Botões: Tema (claro/escuro) + **Sair**
- **Header topo:**
  - Nome da barbearia ativa + botão **"Ver site"** (nova aba)
  - Avatar + nome → clica = `/dashboard/mais`
- **Menu mobile (hambúrguer):** mesma lista da sidebar
- **Barra inferior (celular):** 5 botões fixos — Início, Agenda, Serviços, Equipe, Mais

**Menu por papel:**

| Papel | Itens do Menu |
|-------|---------------|
| **Dono / Gerente** | Início, Agendamentos, Clientes, Serviços, Equipe, **Financeiro**, **Mensagens**, **Meu site**, Mais |
| **Barbeiro** | Início, Agendamentos, Clientes, Serviços, Equipe, Mais |
| **Sem barbearia** | Início, Minhas reservas, Mais |

---

### Início — Dashboard (/dashboard)

**Para que serve:** Resumo do dia + atalhos rápidos. Foto de fundo no header (só tema escuro).

**Cards principais (só dono/gerente vê todos):**

| Card | O que mostra | De onde vem |
|------|--------------|-------------|
| **Atendimentos hoje** | Quantos serviços marcados para hoje | Reservas confirmadas de hoje |
| **Próximos 7 dias** | Total confirmado para a semana | Reservas confirmadas (próximos 7 dias) |
| **Recebido (mês)** | Dinheiro confirmado no mês | Pagamentos com status "confirmado" |
| **Ocupação (7 dias)** | % da agenda preenchida | Horários disponíveis vs. ocupados (reservas + bloqueios) |

**Card "Sua barbearia":** Nome, logo, link para site público

**Botões de ação rápida (só dono/gerente):**
- **Nova reserva** → página pública
- **Ver site** → site público (nova aba)
- **Novo serviço** → cadastra serviço
- **Novo profissional** → cadastra barbeiro

**Agenda do dia (lista):** Próximos atendimentos (clicável para filtrar por dia no calendário lateral)

**Calendário lateral (só dono/gerente):** Mini-calendário → clica no dia = filtra a lista

**Barbeiro/Cliente vê:** Só saudação + "Sua barbearia" + próprios agendamentos do dia

---

### Agendamentos (/dashboard/agendamentos)

**Para que serve:** Ver e gerenciar a agenda. O "diário da barbearia".

**Abas no topo:** **Dia** / **Semana** / **Mês** (botões toggle)

**Navegação:** Botões **Anterior** / **Hoje** / **Próximo** (unidade = dia/semana/mês)

**Visão Dia (lista):**
- Merge de **Reservas** + **Bloqueios** ordenados por horário
- Cada linha (`ReservationCard`):
  - **Reserva:** Foto do profissional, serviço + badge status, horário, cliente/profissional/duração/preço, **WhatsApp clicável**
  - **Bloqueio:** Ícone cadeado, horário, profissional, motivo, botão **Remover** (só dono/gerente)

**Badges de status:**
- 🟡 **Pendente** — aguardando confirmação
- 🟢 **Confirmado** — cliente confirmou
- ⚪ **Concluído** — atendimento feito
- 🔴 **Cancelado** — cancelado
- 🔴 **Faltou** — não compareceu

**Visão Semana:** 7 seções (um por dia) com contagem + lista

**Visão Mês:** Grid 7 colunas, badges de contagem, clica no dia → vai para **Dia**

**Ações por perfil:**

| Ação | Dono/Gerente | Barbeiro |
|------|--------------|----------|
| **Concluir** (reserva confirmada, horário passou) | ✓ | ✓ (só suas) |
| **Marcar falta** (reserva confirmada, horário passou) | ✓ | ✓ (só suas) |
| **Cancelar** (qualquer reserva ativa) | ✓ | ✗ |
| **Bloquear horário** (almoço, folga, compromisso) | ✓ | ✗ |
| **Remover bloqueio** | ✓ | ✗ |

**Botão "Bloquear horário" (só dono/gerente) → Popup:**
- Profissional (radio buttons)
- Início / Fim (data + hora)
- Motivo (opcional: "Almoço", "Folga", etc.)
- Salva → horário fica indisponível para clientes

**Cancelar reserva → Popup confirmação** → cancela → horário volta a ficar livre

**De onde vêm os dados:**
- **Reservas** → cliente agendou (público/painel)
- **Bloqueios** → criados nessa tela pelo dono/gerente
- **Profissionais** → cadastrados em "Equipe"

---

### Clientes (/dashboard/clientes)

**Para que serve:** Ver quem já atendeu na barbearia (derivado das reservas).

**Acesso:** Equipe (dono/gerente/barbeiro)

**O que mostra:**
- Busca por nome/telefone
- Lista paginada com: nome, telefone, email, total de reservas, última visita, tags (Novo / Recorrente)
- Clica no cliente → **Detalhes**: histórico de reservas nessa barbearia

**De onde vêm os dados:** Agrupamento automático das reservas por cliente (WhatsApp/email)

---

### Serviços (/dashboard/servicos)

**Para que serve:** Cadastrar o que a barbearia oferece (corte, barba, hidratação, sobrancelha, etc.).

**Acesso:** Equipe lê; **Dono/Gerente edita**

**Indicadores no topo (só dono/gerente):**
- **Serviços ativos** — quantos estão "ligados"
- **Total de serviços** — tudo cadastrado
- **Ticket médio** — valor médio por atendimento **concluído** (últimos 90 dias, mínimo 3)

**Filtros:** **Todos (X)** / **Mais vendidos (Y)** (persiste ao editar)

**Cards de serviço (grid):**
- Foto principal + carrossel (setas, arraste, pontinhos) — até 5 fotos
- Nome, preço (formatado R$ 00,00), duração (ex: "30 min")
- Badge **"Mais vendido"** (top 3 nos últimos 90 dias)

**Ações (só dono/gerente):**
- **Novo serviço** → Formulário 3 abas:
  - **Básico:** Nome, descrição, preço (centavos, ex: 5000 = R$ 50,00), duração (min), ativo
  - **Fotos:** Upload até 5 (ordena arrastando)
  - **Equipe:** Checkboxes — quais profissionais atendem esse serviço
- **Editar** (lápis) / **Excluir** (lixeira) → confirmação

**Excluir:** Reserva já feita **não muda** (guarda nome/preço/duração no momento da criação)

**De onde vêm os dados:**
- Cadastro manual
- **Vendas reais** → calculadas de atendimentos **concluídos** (últimos 90 dias)

---

### Equipe (/dashboard/equipe)

**Para que serve:** Gerenciar profissionais (barbeiros) e seus horários.

**Acesso:** Equipe lê; **Dono/Gerente edita**

**Cards dos profissionais:**
- Foto quadrada arredondada, nome, badges dos serviços que atende
- Telefone/email (só dono/gerente vê)

**Botões no topo (só dono/gerente):**
- **Gerar link do convite** → Popup: cria link `/convite?token=` (válido 7 dias). Só convida barbeiro. Copia link.
- **Novo profissional** → Abre formulário completo

**Ao clicar no profissional (editar) → 4 abas:**

| Aba | O que configura |
|-----|-----------------|
| **Dados** | Nome, ativo/inativo, quais serviços atende (checkboxes) |
| **Horários** | **Jornada semanal** (Seg–Dom): entrada, saída, pausa almoço (início/fim), folga. Vários turnos por dia. |
| **Conta** | Vincula login do barbeiro (para ele entrar no painel) |
| **Contato** | Telefone, email, CPF/CNPJ (só dono/gerente) |

**Foto:** Upload + corte quadrado automático

**Excluir → Confirmação** → sai da equipe, não aparece mais para clientes

**De onde vêm os dados:** Cadastro manual + horários definidos aqui

---

### Financeiro (/dashboard/financeiro)

**Para que serve:** Controlar todo o dinheiro da barbearia.

**Header:** Abas + seletor de mês (só Resumo e Custos) + faixa com foto

**Dono/Gerente — 5 Abas:**

| Aba | O que mostra | Ações |
|-----|--------------|-------|
| **Resumo** | Cards: Recebido (confirmado), A receber (a confirmar), A declarar (sem pagamento), Ticket médio. Gráfico evolução mês. Origem dos valores. Movimentações recentes. | Ver |
| **Pagamentos** | Lista todos. Filtros: status, forma (PIX/Dinheiro/Débito/Crédito), período. | **Confirmar** (entra no caixa), **Descartar** (cancela pendente), **Estornar** (devolve confirmado) |
| **Comissões** | Por profissional: provisionado (a pagar), liquidado (já pago), cancelado. Regras (% ou fixo por serviço). Badge "Mais vendido" nos serviços. | Ver / Configurar regras |
| **Repasses** | Histórico de repasses aos barbeiros (valor, data, status). | Ver |
| **Custos** | Lançamentos de despesas (aluguel, produtos, etc.). Total do mês. | Adicionar / Editar / Excluir |

**Barbeiro vê só — "Meus ganhos":**
- Cards: **A receber** (provisionado) + **Já repassado** (liquidado)
- Lista das próprias comissões + repasses recebidos

**Regras de Ouro:**
1. Pagamento **a confirmar** → **NÃO** soma no "Recebido"
2. Só dono/gerente **confirma** pagamento → aí entra no caixa
3. Reserva com pagamento (confirmado OU pendente) → **NÃO pode cancelar**
4. Estorno → só de pagamento **confirmado**
5. Dinheiro trafega em **centavos** (inteiro); digitação direita→esquerda (00,00 → 1.000,00)

**De onde vêm os dados:**
- Pagamentos → lançados na reserva (cliente/painel) + confirmação manual
- Comissões → calculadas automaticamente por regra (% ou fixo) no atendimento **concluído**
- Repasses → criados manualmente pelo dono/gerente
- Custos → lançados manualmente

---

### Mensagens (/dashboard/mensagens)

**Para que serve:** Central de WhatsApp + configuração de avisos automáticos.

**Acesso:** **Só Dono/Gerente**

**Abas (URL `?aba=`):**

#### Aba "Mensagens" — Fila de Envios
- **Faixa topo:** Status WhatsApp (Verificando / Conectar / Conectado / Desconectar). Clica "Conectar" → QR Code Evolution API.
- **Cards de indicadores:** Pendentes / Enviadas / Falharam / Respostas recebidas
- **Filtros:** Todas / Pendentes / Enviadas / Falharam
- **Lista (`MessageRow`):** Tipo (confirmação/lembrete), cliente, horário, status, **resposta do cliente** (SIM = confirma / NÃO = cancela)
- **Desktop (≥1280px):** Painel lateral direito com detalhes
- **Tablet/Mobile:** Popup ao clicar (`MessageBookingDialog`)

**Detalhes da mensagem (clique):**
- Dados da reserva (cliente, serviço, profissional, horário, valor)
- **Ações:** **Reagendar** / **Pagamento** / **Cancelar** (abrem popups)
- Histórico de envios (tentativas, erros)
- **Apagar mensagem** → remove da fila + registros de envio (reserva/financeiro intactos)

**Respostas recebidas (`ReplyList`):** Lista de SIM/NÃO dos clientes com horário

#### Aba "Notificações" — Configuração de Avisos Automáticos
- **Templates editáveis** (prévia ao vivo):
  - **Confirmação** → quando agenda (variáveis: `{{cliente}}`, `{{servico}}`, `{{profissional}}`, `{{data}}`, `{{hora}}`, `{{link}}`)
  - **Lembrete** → antes do horário (mesmas variáveis)
- **Canais:** WhatsApp (estado real), SMS, Email
- **Quando mandar lembrete:** 24h, 2h, etc. (`ReminderConfigCard`)
- **Consentimento de novidades** (marketing) — opt-in do cliente
- **Retorno de cliente inativo** (migração 0020): ativo/inativo, quantidade, unidade (dias/semanas/meses), template `msg_retorno`, card dedicado

**Estado do WhatsApp (`whatsappState`):** Único para as duas abas, cache `whatsapp-status`

**De onde vêm os dados:**
- Fila → gerada automaticamente ao confirmar reserva (se cliente autorizou lembretes)
- Templates → salvos no banco da barbearia
- Respostas → webhook Evolution API → inbox

---

### Meu Site (/dashboard/site)

**Para que serve:** Editor visual do site público. **Só Dono/Gerente**.

**Layout:** 2 colunas — **Esquerda: Editor** / **Direita: Prévia**

#### Editor (esquerda) — 5 Blocos:

| Bloco | O que faz |
|-------|-----------|
| **1. Template** | 5 cards (Urbano, Clássico, Minimalista, Moderno, Premium). Clica = vê na prévia na hora. **"Selecionado, não salvo"** se mudou. Precisa migração 0011 para salvar. |
| **2. Marca** | **Logo** + **Capa** (tiles clicáveis). Clica na foto → **Ajuste de zoom/posição** (corte automático pro template escolhido). Lápis = troca arquivo. Lixeira = remove. Prévia muda **ao vivo** durante ajuste. |
| **3. Galeria** | Grid 4 colunas, até 5 fotos. Upload direto. Lixeira = remove. |
| **4. Cores** | Bolinhas (`AccentPicker`). Clica = **muda na hora** na prévia + no painel + salva como cor da barbearia. |
| **5. Endereço do site** | Input slug (ex: `minhabarbearia`). Só dono altera. Validação (letras, números, hífen). Check disponibilidade (debounce 400ms). Botão **Copiar link**. |

**Botão único no rodapé:** **"Salvar alterações"** → grava **template + descrição + endereço** de uma vez. Fotos e cor **já gravaram na hora**.

#### Prévia (direita):
- **Galeria de templates:** 5 miniaturas reais (dados salvos, não mexe no crop). Clica = aplica na prévia grande.
- **Prévia grande responsiva:** Desktop / Tablet / Celular (ver de verdade como fica via `@container` queries)
- Badge **"Não salvo"** se mudou template ou descrição
- Aviso se barbearia inativa: "O site não aparece para os clientes"

**Templates (5):** Todos usam o **mesmo contrato de dados** (`SiteView`). Mudam só a apresentação. Lógica de reserva **nunca** vai nos templates.

**De onde vêm os dados:** Cadastro nos blocos acima + Serviços/Profissionais ativos (puxa automaticamente)

---

### Mais (/dashboard/mais)

**Para que serve:** Configurações da barbearia e da conta.

**Dono/Gerente — 2 Abas (`?aba=`):**

#### Aba "Dados da barbearia" (`ShopDataTab`)
- **Informações:** Nome, descrição, fuso horário, status (Ativo/Inativo)
- **Endereço:** CEP (busca ViaCEP), rua, número, complemento, bairro, cidade, UF
- **Dados fiscais (só dono):** CPF/CNPJ, IE, IM, Regime tributário
- **Coluna direita (final):** **Plano** (`PlanCard`) + **Google Calendar** (`CalendarCard`)
- **Dois cards lado a lado:**
  1. **Contato comercial** — WhatsApp + Email comercial (salvamento único)
  2. **Integração WhatsApp** — `WhatsAppConnect` (mesmo de Mensagens › Notificações)
     - "Verificando conexão…" → "Conectar WhatsApp" (vermelho, QR Code) → consulta a cada 3s / renova QR a cada 30s → "Conectado" + botão "Desconectar" (verde)

#### Aba "Documentos" (`DocumentsTab`)
- Bucket privado (Supabase Storage)
- **Só dono** acessa
- Link assinado **válido 60 segundos** para download

**Barbeiro / Cliente — Versão Curta:**
- "Quem sou" (nome, papel, barbearia, endereço público)
- Google Calendar (se barbeiro)
- **Aparência** — seletor cor de destaque pessoal (`AccentPicker`)
- **Novidades** — aceitar/receber marketing (`PreferencesCard`)

**Sem barbearia:** Tela "Você ainda não tem barbearia" + botão **"Criar barbearia"** → `/dashboard/barbearias/nova`

**Abas antigas redirecionam automaticamente:**
- `?aba=notificacoes` → `/dashboard/mensagens?aba=notificacoes`
- `?aba=horario` → `/dashboard/equipe`
- `?aba=whatsapp` → `/dashboard/mais?aba=dados`

---

### Nova Barbearia (/dashboard/barbearias/nova)

**Para que serve:** Criar uma nova barbearia (só dono).

**O que faz:** Formulário (nome, slug, fuso, dono) → cria barbearia + vincula como proprietário → redireciona para `/dashboard`

---

## 3. COMPONENTES E PADRÕES VISUAIS (Resumo)

### Dinheiro
- **MoneyInput:** Digita da direita para esquerda (00,00 → 1.000,00). Guarda em **centavos**.
- **formatPrice(centavos)** → "R$ 1.000,00"

### Datas e Horários
- **Nunca** input nativo (`type="date"`). Usa `DateField`, `TimeField`, `DateTimeField` (popup calendário).
- Fuso da barbearia; instantes em UTC.

### Listas Suspensas
- **Nunca** `<select>` nativo. Usa `OptionSelect` (abre abaixo, ícone opcional).
- Forma pagamento: `PaymentFormSelect` com ícones (PIX, Dinheiro, Débito, Crédito).

### Cor de Destaque (Accent)
- **Por USUÁRIO** (conta) → salva em `user_metadata.accent` → aplica no `<html data-accent="...">`
- Visitante sem conta → vê cor da barbearia (`cor_destaque`)
- Em "Meu Site": clique na bolinha → **muda na hora** prévia + painel + salva na barbearia
- **Nunca** usar `style` direto no componente

### Cards Únicos (Mesmo componente em todo sistema)

| Componente | Onde aparece | Característica |
|------------|--------------|----------------|
| `ReservationCard` | Agendamentos (painel) | Foto prof. quadrada esquerda, dados centro, ações direita |
| `ClientReservationCard` | Minhas reservas (cliente) | Foto do **serviço** cadastrada, ações Reagendar/Cancelar |
| `ServiceCard` | Serviços (painel + público) | Carrossel fotos (setas, arraste, pontinhos), até 5 fotos |
| `ProfessionalCard/Photo` | Equipe, agendamentos | Foto quadrada arredondada esquerda |
| `ProfessionalTag` | Listas compactas | Nome + foto minúscula |

### Agendamento Público (BookingDialog)
- Modal 3 passos: **Profissional** → **Calendário + Horários** (`SlotPicker`) → **Dados**
- Key única por abertura (evita duplicação)
- Rascunho em `sessionStorage` (sobrevive ao login)

### Layout do Painel (Não Quebrar)
- `Shell`: `relative h-dvh overflow-hidden` → sidebar/header fixos, **só main rola**
- **Obrigatório `relative`** (sem ele, inputs escondidos escapam e body rola)
- Nunca `min-h-dvh` nem scroll no `body` dentro do painel

---

## 4. TRATAMENTO DE ERROS (Padrão Simples)

**Em toda tela com dados:**
```
1. Migration faltando → "Módulo indisponível. Ainda sendo preparado no banco."
2. Erro de carga → Card "Não foi possível carregar" + botão "Tentar novamente"
3. Carregando → Esqueletos cinza (Skeleton)
4. Vazio → "Nenhum cadastrado" + botão de ação (se tiver permissão)
```

**Ações perigosas (excluir, cancelar):**
- Sempre **Popup de confirmação** (`ConfirmDelete`) → "Tem certeza? Isso não tem volta."
- Loading no botão durante execução
- Sucesso → Toast verde + atualiza lista
- Erro → Toast vermelho / erro inline no formulário

**Segurança real:** No banco (RLS + funções `private.has_role` / `private.is_member`). Frontend só UX.

---

## 5. MIGRATIONS PRINCIPAIS (Status)

| # | Assunto | Status |
|---|---------|--------|
| 0001–0010 | Base (identidade, serviços, agenda, financeiro, WhatsApp, site, planos, Google Calendar, fotos) | ✅ Aplicadas no remoto |
| 0011 | Modelo do site (template, save_site_template) | ✅ Aplicada 2026-11-07 |
| 0012 | Dados barbearia (contato, endereço, fiscal) | ⏳ Pronta, aguarda aprovação |
| 0013 | Documentos privados | ⏳ Pronta, aguarda aprovação |
| 0017–0020 | Lembretes, fila WhatsApp, templates msg, retorno cliente | ✅ Aplicadas 2026-11-07 |

**Regra:** 1 migration = 1 assunto. Editar aplicada → edita arquivo + aplica só diferença no remoto (com autorização).

---

## 6. FLUXOS PRINCIPAIS (Resumo)

### Cliente Final
1. Entra em `/:slug` (link da barbearia)
2. Vê site com template escolhido → clica **"Reservar"**
3. Popup 3 passos: Profissional → Dia/Horário → Dados (nome/WhatsApp)
4. Se não logado → salva rascunho → login → reabre com dados
5. **Confirma** → "Reserva confirmada" + botão "Ver minhas reservas"
6. Acessa `/:slug/minhas-reservas` → login → vê **Próximas** (reagendar/cancelar) + **Histórico**

### Equipe (Dashboard)
1. Entra em `/` → login → `/dashboard`
2. **Início** → vê cards do dia + atalhos
3. **Agendamentos** → gerencia agenda (dia/semana/mês), bloqueios, conclui/falta/cancela
4. **Serviços** → CRUD + vê vendas reais + "Mais vendido"
5. **Equipe** → CRUD profissionais, horários na edição, convites
6. **Financeiro** → 5 abas (gestão) / "Meus ganhos" (barbeiro)
7. **Mensagens** → Fila WhatsApp + config templates automáticos
8. **Meu Site** → Editor 5 templates, prévia responsiva, salvar único
9. **Mais** → 2 abas: Dados (info, endereço, fiscal, plano, GC, contato+WhatsApp) + Documentos

---

## 7. PERMISSÕES POR TELA (Matriz Completa)

| Tela / Rota | Cliente | Barbeiro | Gerente | Dono |
|-------------|---------|----------|---------|------|
| **Públicas** | | | | |
| `/` (Landing) | ✓ | ✓ | ✓ | ✓ |
| `/:slug` (Site barbearia) | ✓ | ✓ | ✓ | ✓ |
| `/:slug/minhas-reservas` | ✓ (ver/gerir) | ✓ | ✓ | ✓ |
| `/minhas-reservas` (global) | ✓ | ✓ | ✓ | ✓ |
| `/acesso` | ✓ | ✓ | ✓ | ✓ |
| `/convite?token=` | ✓ (aceitar) | ✓ | ✓ | ✓ |
| **Painel (precisa login)** | | | | |
| `/dashboard` (Início) | ✗ → `/minhas-reservas` | ✓ | ✓ | ✓ |
| `/dashboard/agendamentos` | ✗ | Ver própria + concluir/falta | Completo | Completo |
| `/dashboard/clientes` | ✗ | ✓ | ✓ | ✓ |
| `/dashboard/servicos` | ✗ | Ver | Editar | Editar |
| `/dashboard/equipe` | ✗ | Ver | Editar + convidar | Editar + convidar |
| `/dashboard/financeiro` | ✗ | Meus ganhos | Completo | Completo |
| `/dashboard/mensagens` | ✗ | ✗ | ✓ | ✓ |
| `/dashboard/site` | ✗ | ✗ | ✓ | ✓ |
| `/dashboard/mais` | Versão curta | Versão curta | Completo | Completo |
| `/dashboard/barbearias/nova` | ✗ | ✗ | ✗ | ✓ |

> **Nota:** Cliente que só tem vínculo de cliente (`isCustomerOnly`) é **devolvido para `/minhas-reservas`** ao tentar acessar telas de gestão. A proteção real é no banco (RLS), não no botão.

---

*Documento em linguagem simples para apresentação a não-técnicos. Baseado no código real: React 19 + Vite + TypeScript + Tailwind v4 + React Query + Supabase (projeto `hbkbdqctelembzqiptpi`).*