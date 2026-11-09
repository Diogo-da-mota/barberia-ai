# Barberia AI — Fluxo Simples (Exemplo)

---

## Dashboard (Tela Inicial)

**Para que serve:** Página principal do painel. Mostra o resumo do dia e atalhos rápidos.

**O que mostra:**
| Card | O que é | De onde vem |
|------|---------|-------------|
| **Atendimentos hoje** | Quantos cortes/serviços estão marcados para hoje | Agenda da barbearia (reservas confirmadas de hoje) |
| **Próximos 7 dias** | Total de agendamentos confirmados para a semana | Agenda da barbearia (próximos 7 dias) |
| **Recebido (mês)** | Dinheiro que já entrou no caixa este mês (só pagamentos confirmados) | Financeiro → pagamentos com status "confirmado" |
| **Ocupação (7 dias)** | % da agenda preenchida nos últimos 7 dias | Horários disponíveis vs. horários ocupados por reservas/bloqueios |
| **Sua barbearia** | Card com nome, foto e link para o site público | Cadastro da barbearia (nome, logo, slug) |

**Botões de ação rápida:**
- **Nova reserva** → abre a página pública para agendar
- **Ver site** → abre o site da barbearia em nova aba
- **Novo serviço** → cadastra um serviço (corte, barba, etc.)
- **Novo profissional** → adiciona um barbeiro na equipe

---

## Agendamentos (/dashboard/agendamentos)

**Para que serve:** Ver e gerenciar a agenda do dia/semana/mês. É o "diário da barbearia".

**O que mostra:**
- **Abas no topo:** Dia / Semana / Mês (clique para alternar)
- **Lista de horários:** Cada linha mostra:
  - Horário (ex: 10:00 – 10:30)
  - Serviço (ex: Corte + Barba)
  - Profissional (foto + nome)
  - Cliente (nome + WhatsApp clicável)
  - Status: **Pendente** (amarelo) / **Confirmado** (verde) / **Concluído** (cinza) / **Cancelado** (vermelho) / **Faltou** (vermelho)
  - Valor do serviço

**Ações por perfil:**
| Perfil | Pode fazer |
|--------|------------|
| **Dono/Gerente** | Tudo: concluir, marcar falta, cancelar, bloquear horário (almoço/folga) |
| **Barbeiro** | Só vê a própria agenda. Pode: **Concluir** ou **Marcar falta** |

**Botão "Bloquear horário" (só dono/gerente):**
- Abre popup: escolhe o profissional, data/hora início e fim, motivo (ex: "Almoço", "Folga")
- Esse horário fica indisponível para clientes agendarem

**De onde vêm os dados:**
- **Reservas** → feitas pelo cliente no site público ou pelo painel
- **Bloqueios** → criados pelo dono/gerente nessa tela
- **Profissionais** → cadastrados em "Equipe"

---

## Serviços (/dashboard/servicos)

**Para que serve:** Cadastrar o que a barbearia oferece (corte, barba, hidratação, etc.).

**O que mostra:**
- **Cards de serviço:** Foto, nome, preço, duração, badge "Mais vendido" (se for top 3 nos últimos 90 dias)
- **Filtros:** "Todos" / "Mais vendidos"
- **Indicadores (só dono/gerente):**
  - Serviços ativos
  - Total de serviços
  - Ticket médio (valor médio por atendimento concluído nos últimos 90 dias)

**Ações (só dono/gerente):**
- **Novo serviço** → abre formulário: nome, descrição, preço (em centavos, ex: 5000 = R$ 50,00), duração em minutos, ativo/sim
- **Editar** (lápis) / **Excluir** (lixeira)
- **Fotos:** até 5 fotos por serviço (carrossel com setas)

**De onde vêm os dados:**
- Cadastro manual nessa tela
- Vendas reais → calculadas automaticamente a partir de atendimentos **concluídos** (status "concluído") nos últimos 90 dias

---

## Equipe (/dashboard/equipe)

**Para que serve:** Gerenciar os profissionais (barbeiros) e seus horários.

**O que mostra:**
- **Cards dos profissionais:** Foto, nome, serviços que atende (badges), telefone/email (só dono/gerente vê)
- **Botões no topo:**
  - **Gerar link do convite** → cria link `/convite?token=` para chamar novo barbeiro (válido 7 dias)
  - **Novo profissional** → cadastra manualmente

**Ao clicar em um profissional (editar):**
| Aba | O que configura |
|-----|-----------------|
| **Dados** | Nome, ativo/inativo, quais serviços atende |
| **Horários** | Jornada semanal: segunda a domingo, horário de entrada, saída, pausa almoço, folga |
| **Conta** | Vincula login do barbeiro (para ele entrar no painel) |
| **Contato** | Telefone, email, CPF/CNPJ (só dono/gerente) |

**De onde vêm os dados:** Cadastro manual + horários definidos aqui

---

## Financeiro (/dashboard/financeiro)

**Para que serve:** Controlar o dinheiro: o que entrou, o que vai entrar, comissões, repasses e custos.

**Abas (só dono/gerente):**

| Aba | O que mostra |
|-----|--------------|
| **Resumo** | Cards: Recebido (confirmado), A receber (a confirmar), A declarar (sem pagamento), Ticket médio. Gráfico do mês. Lista de movimentações recentes. |
| **Pagamentos** | Lista todos os pagamentos. Filtros: status, forma (PIX/Dinheiro/Débito/Crédito), período. Ações: **Confirmar** (entra no caixa), **Descartar** (cancela pendente), **Estornar** (devolve confirmado). |
| **Comissões** | Por profissional: provisionado (a pagar), liquidado (já pago), cancelado. Regras de comissão (% ou valor fixo por serviço). |
| **Repasses** | Histórico de repasses feitos aos barbeiros (valor, data, status). |
| **Custos** | Lançamentos de despesas (aluguel, produtos, etc.). Total do mês. |

**Barbeiro vê só:** "Meus ganhos" → A receber + Já repassado + lista das suas comissões.

**Regras importantes:**
- Pagamento **a confirmar** não soma no "Recebido"
- Só dono/gerente **confirma** pagamento → aí entra no caixa
- Reserva com pagamento (confirmado ou pendente) **não pode ser cancelada**
- Estorno só de pagamento confirmado

---

## Mensagens (/dashboard/mensagens)

**Para que serve:** Central de WhatsApp e configuração de avisos automáticos.

**Abas:**

| Aba | O que faz |
|-----|-----------|
| **Mensagens** | Fila de envios: confirmações, lembretes. Mostra status (pendente/enviado/falhou) e resposta do cliente (SIM = confirma, NÃO = cancela). Clique → vê detalhes da reserva + botões: Reagendar, Pagamento, Cancelar. |
| **Notificações** | Edita os textos que vão pro WhatsApp: **Confirmação** (quando agenda) e **Lembrete** (antes do horário). Variáveis: `{{cliente}}`, `{{servico}}`, `{{profissional}}`, `{{data}}`, `{{hora}}`, `{{link}}`. Prévia ao vivo. Configura: quando mandar lembrete (24h, 2h, etc.), consentimento de marketing. |

**Faixa no topo:** Status do WhatsApp (Verificando / Conectar / Conectado / Desconectar). Clica "Conectar" → abre QR Code do Evolution API.

---

## Meu Site (/dashboard/site)

**Para que serve:** Editor visual do site público da barbearia.

**Lado esquerdo (editor):**
1. **Template** — Escolhe 1 de 5 modelos (Urbano, Clássico, Minimalista, Moderno, Premium). Clica = vê na prévia na hora. Salva só no botão final.
2. **Marca** — Logo e Capa. Clica na foto → abre ajuste de zoom/posição (corte automático pro template). Lápis = troca foto. Lixeira = remove.
3. **Galeria** — Até 5 fotos do ambiente. Upload direto.
4. **Cores** — Bolinhas de cor. Clica = muda na hora na prévia e no painel. Salva como cor da barbearia.
5. **Endereço do site** — Link público (ex: `barberia.ai/minhabarbearia`). Só dono altera. Botão copiar link.

**Lado direito (prévia):**
- 5 miniaturas dos templates (clique = aplica na prévia grande)
- Prévia responsiva: Desktop / Tablet / Celular (ver de verdade como fica)
- Badge "Não salvo" se mudou template ou descrição

**Botão único no rodapé:** **"Salvar alterações"** → grava template + descrição + endereço de uma vez. Fotos e cor já gravaram na hora.

---

## Mais (/dashboard/mais)

**Para que serve:** Configurações da barbearia e da conta.

**Dono/Gerente (2 abas):**

| Aba | O que tem |
|-----|-----------|
| **Dados da barbearia** | Info básica (nome, descrição, fuso, status ativo/inativo). Endereço com busca de CEP. Dados fiscais (CPF/CNPJ, IE, IM, regime) — **só dono vê**. Plano e Google Calendar no final. Dois cards lado a lado: **Contato comercial** (WhatsApp + Email) e **Integração WhatsApp** (mesma conexão da tela Mensagens). |
| **Documentos** | Arquivos privados (contrato, alvará, etc.). Só dono acessa. Link temporário de 60 segundos. |

**Barbeiro / Cliente vê versão curta:**
- "Quem sou" (nome, papel, barbearia)
- Google Calendar (se barbeiro)
- Aparência (cor de destaque pessoal)
- Novidades (aceitar/receber marketing)

**Abas antigas redirecionam automaticamente:**
- Notificações → Mensagens
- Horário → Equipe
- WhatsApp → Dados da barbearia

---

## Página Pública da Barbearia (/:slug)

**Para que serve:** Site que o cliente vê para agendar. Cada barbearia tem seu link.

**O que mostra:**
- Template escolhido no "Meu Site" (5 opções)
- Seções: Início, Serviços, Profissionais, Galeria, Contato (rolagem suave, URLs próprias: `/slug/servicos`, etc.)
- Botão **"Reservar"** → abre agendamento em 3 passos

**Agendamento (3 passos no popup):**
1. **Profissional** → "Qualquer um disponível" ou escolhe um (com foto)
2. **Dia e horário** → Calendário + horários livres (respeita jornada, pausas, duração do serviço)
3. **Seus dados** → Nome, WhatsApp, checkboxes: "Quero lembretes" + "Aceito promoções"
4. **Confirmar** → se não logado, pede login/criar conta e reabre com dados salvos

**Após confirmar:** Tela "Reserva confirmada" + botão "Ver minhas reservas"

---

## Minhas Reservas por Barbearia (/:slug/minhas-reservas)

**Para que serve:** Área do cliente **dessa barbearia específica**. Layout com a cara da marca (cor, template, fotos).

**Sem login:** Tela "Acesso" → botões Entrar / Criar conta

**Com login:**
- **Lateral (desktop):** Foto do ambiente + resumo (cards: "Próximas reservas" + "Histórico" + botão "Nova reserva")
- **Principal:** Duas seções:
  - **Próximas** → cards com foto do serviço, data/horário, profissional, botões **Reagendar** / **Cancelar**
  - **Histórico** → atendimentos passados (só visualização)
- **Mobile:** Resumo vira faixa compacta no topo

---

## Minhas Reservas Global (/minhas-reservas)

**Para que serve:** Todas as reservas do cliente em **todas as barbearias**. Usa layout do painel (sidebar).

**Acesso:** Precisa estar logado. Se não tem barbearia recente, vai para `/acesso`.

---

## Convite de Equipe (/convite?token=)

**Para que serve:** Aceitar convite para trabalhar na barbearia.

**Fluxo:**
1. Clica no link recebido (WhatsApp/email)
2. Se já logado → botão "Aceitar convite" → entra na equipe → vai para `/dashboard`
3. Se não logado → "Entrar para aceitar" → login → aceita automaticamente

---

## Acesso Neutro (/acesso)

**Para que serve:** Porta de entrada do cliente quando não sabe qual barbearia.

**Mostra:** Tela de login/criar conta + texto "Para agendar, abra a página da sua barbearia."

---

## Resumo Rápido de Permissões

| Tela | Cliente | Barbeiro | Gerente | Dono |
|------|---------|----------|---------|------|
| Site público (agendar) | ✓ | ✓ | ✓ | ✓ |
| Minhas reservas (da barbearia) | ✓ | ✓ | ✓ | ✓ |
| Minhas reservas (todas) | ✓ | ✓ | ✓ | ✓ |
| Dashboard (início) | ✗ | ✓ | ✓ | ✓ |
| Agendamentos | ✗ | Ver própria + concluir/falta | Completo | Completo |
| Clientes | ✗ | ✓ | ✓ | ✓ |
| Serviços | ✗ | Ver | Editar | Editar |
| Equipe | ✗ | Ver | Editar + convidar | Editar + convidar |
| Financeiro | ✗ | Meus ganhos | Completo | Completo |
| Mensagens | ✗ | ✗ | ✓ | ✓ |
| Meu Site | ✗ | ✗ | ✓ | ✓ |
| Mais (configurações) | Versão curta | Versão curta | Completo | Completo |
| Nova barbearia | ✗ | ✗ | ✗ | ✓ |

---

*Linguagem simples para apresentação a não-técnicos. Baseado no código real (React + Supabase).*