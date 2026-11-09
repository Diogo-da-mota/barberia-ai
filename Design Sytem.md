# Design System — Financeiro Diogo

**Versão:** 1.0  
**Status:** implementado  
**Aplicação:** Web (PWA), mobile-first  
**Idioma:** português do Brasil

---

## 1. Objetivo

O design serve à pergunta: **"O que tenho, o que devo e o que vence?"**. Valor, data, status e ação principal vêm antes da decoração.

Compacto, financeiro, confiável e calmo. Sem anúncios, gamificação, efeitos excessivos ou telas literalmente copiadas de referência.

---

## 2. Princípios

| # | Princípio |
|---|-----------|
| 1 | Botão proporcional: 32–40px desktop, 40–44px mobile. CTA isolado mobile até 48px. |
| 2 | Modal padrão até 480px; formulário maior até 640px. Acima disso, página dedicada. |
| 3 | Cards enxutos: sem espaço vazio, sem card dentro de card, sem bordas pesadas. |
| 4 | Sem repetir a mesma ação em botão "Novo", FAB e rodapé ao mesmo tempo. |
| 5 | Valores alinhados, com sinal, moeda, cores semânticas e `tabular-nums`. |
| 6 | Listas e tabelas compactas, sem sacrificar legibilidade e toque. |
| 7 | Sem scroll horizontal da página nos breakpoints alvo. |
| 8 | Sem efeitos gratuitos: sombras discretas, animações breves, respeito a movimento reduzido. |
| 9 | Light/dark equivalentes: mesmo significado semântico, contraste e hierarquia nos dois temas. |
| 10 | Componentes centralizados em `src/ui/`. Reutilizar variante existente em vez de recriar. |

---

## 3. Tokens de cor

Definidos em `src/index.css` via variáveis CSS (`--*`). Usar sempre os tokens, nunca hexadecimais soltos.

### 3.1 Paleta semântica

| Token | Light | Dark | Uso |
|-------|-------|------|-----|
| `--background` | `#F1F1EC` | `#0D0F12` | Tela de fundo |
| `--card` | `#FFFFFF` | `#171A1F` | Cards, shell |
| `--surface-alt` | `#E8E8E1` | `#21252B` | Linha selecionada, fundo alternativo |
| `--foreground` | `#15171A` | `#F2F2EC` | Texto principal |
| `--muted-foreground` | `#585D65` | `#A2A7AF` | Texto secundário |
| `--border` | `#D9D9D0` | `#2C3138` | Borda hairline |
| `--primary` | `#FFB000` | `#FFB000` | Ação, foco, seleção (âmbar) |
| `--primary-foreground` | `#15171A` | `#121417` | Texto sobre primário |
| `--link` | `#8A5700` | `#FFBE33` | Links |
| `--income` | `#157347` | `#4CC38A` | Receita / entrada |
| `--expense` | `#C8381C` | `#FF6A4D` | Despesa / saída |
| `--warning` | `#8A5700` | `#FFB000` | Atenção / próximo vencimento |
| `--danger` | `#B42318` | `#FF6A4D` | Excluir / destrutivo |
| `--info` | `#1F5FBF` | `#6AA8FF` | Informativo |

### 3.2 Board (painel de embarque)

| Token | Light | Dark | Uso |
|-------|-------|------|-----|
| `--board` | `#121417` | `#07080A` | Fundo do board |
| `--board-foreground` | `#F4F4EF` | `#F2F2EC` | Texto no board |
| `--board-muted` | `#8E939A` | `#8E939A` | Texto secundário no board |
| `--board-line` | `#262A30` | `#1D2126` | Linhas do board |
| `--board-amber` | `#FFB000` | `#FFB000` | Âmbar no board |
| `--board-alert` | `#FF5A3C` | `#FF6A4D` | Alerta no board |

### 3.3 Categorias (cores validadas: CVD ΔE ≥ 8, contraste ≥ 3:1)

| Token | Light | Dark |
|-------|-------|------|
| `--cat-blue` | `#2a78d6` | `#3987e5` |
| `--cat-orange` | `#eb6834` | `#d95926` |
| `--cat-aqua` | `#12a07a` | `#199e70` |
| `--cat-yellow` | `#b27a00` | `#c98500` |
| `--cat-magenta` | `#c2417a` | `#d55181` |
| `--cat-green` | `#008300` | `#008300` |
| `--cat-violet` | `#6250d6` | `#9085e9` |
| `--cat-red` | `#e34948` | `#e66767` |
| `--cat-slate` | `#64748b` | `#94a3b8` |

**Regra:** cor de receita/despesa informa **natureza da movimentação**, não progresso emocional. Status usa também texto e ícone. Limite disponível não deve parecer saldo próprio. Não introduzir rosa, roxo e dourado por funcionalidade sem necessidade.

---

## 4. Tipografia

| Escala | Tamanho mobile | Tamanho desktop | Uso |
|--------|----------------|-----------------|-----|
| Página (h1) | 22–26px | 24–28px | Título de página |
| Seção (h2) | 16–20px | 18–22px | Título de seção |
| Corpo | 14–16px | 14–16px | Texto corrido |
| Metadados | 12–13px | 12–13px | Apenas quando não essenciais |
| Inputs mobile | 16px | — | Evita zoom no iOS |
| Destaque monetário | 28–36px | 28–36px | Saldo/dashboard |

- Fonte corpo: **Barlow** (400, 500, 600, 700) com fallback de sistema.
- Fonte destaque: **Barlow Condensed** (600, 700, 800).
- Números financeiros: `font-variant-numeric: tabular-nums` (valores alinhados).
- Preferir 1–2 pesos principais (regular/semibold/bold). Não misturar quatro famílias.
- Inputs mobile com **16px** para evitar zoom indesejado no iOS.

---

## 5. Espaçamento e grid

Escala base **4px**: 4, 8, 12, 16, 20, 24, 32; 40/48 somente para respiros de seção.

| Elemento | Mobile | Tablet | Desktop |
|----------|--------|--------|---------|
| Padding lateral página | 16px | 20–24px | 24–32px |
| Padding de card | 12–16px | 16–20px | 16–20px |
| Gap entre cards | 12–16px | 12–16px | 12–16px |
| max-width grade | 100% | — | 1120px |
| max-width lista | 100% | — | 768px |

- Conteúdo desktop centralizado com `max-width 1120px` em telas de grade (Início, Cartões, Bancos, Planejamento, Captura, Relatórios) e `768px` em telas de lista (Lançamentos, Contas a pagar, Dívidas, Categorias, Mais, Configurações).
- Formulários: 1 coluna mobile, até 2 colunas desktop quando fizer sentido (ex.: valor + data).
- Listas: linha informativa 52–64px quando há título + metadado; 44–52px quando simples.

---

## 6. Raio e cantos

| Token | Valor | Uso |
|-------|-------|-----|
| `--radius-sm` | 6px | Etiquetas, chips pequenos |
| `--radius-md` | 10px | Inputs, botões, linhas interativas |
| `--radius-lg` | 10px | — |
| `--radius-xl` | 14px | — |
| `--radius-2xl` | 16px | — |
| `--radius-card` | 6px 20px 6px 20px | Padrão de todos os cards (cantos alternados) |
| `--radius-editorial` | 20px 6px 20px 6px | Painéis editoriais selecionados |

**Não usar o editorial em todos os cards.** Escolher pelo tipo e manter consistente. Cards de transação comuns podem ser 12–16px uniformes para leitura rápida.

---

## 7. Bordas, sombras e superfícies

- Borda de 1px com token `border`, sem dupla moldura desnecessária.
- Estado selecionado: borda primária + fundo tonal suave, não apenas cor.
- Sombras discretas em overlays e cards que precisem de elevação. Evitar glow permanente azul.
- Cards de dívida/alerta: status por chip, texto e detalhe. Evitar fundo todo vermelho.
- Ícone em bloco tonal: 32–40px, pictograma 16–20px. Não usar emojis como ícones de interface.

---

## 8. Tamanhos de componentes (contrato)

| Componente | Compacto | Padrão | Limite / regra |
|------------|----------|--------|----------------|
| Botão desktop | 32px | 36–40px | Não ultrapassar 44px sem motivo |
| Botão mobile | 40px | 44px | CTA único até 48px |
| Botão com ícone | 32–36px | 40px | Área tocável/foco acessível |
| Campo texto/select | 40px (desktop) | 44px (mobile) | Fonte 16px mobile; label sempre visível |
| Chips/filtros | 28–32px | 32–36px | Quebrar linha quando necessário |
| Modal comum (desktop) | 360px | 480px largura | Máx. 640px para formulário; acima: página |
| Modal/sheet mobile | Largura disponível | Largura disponível | Altura máxima ~85–90dvh, scroll só no conteúdo |
| Card KPI | 100–120px altura | Conteúdo variável | Evitar altura fixa vazia |

**Modal:** título curto, subtítulo opcional, campos agrupados, rodapé de ações compacto. Nunca cortar botão Salvar ou campo em telas pequenas. Não acumular scroll do modal + scroll de subpainel.

---

## 9. Dropdown (Select)

Único dropdown do projeto: `Select` de `src/ui/select.tsx` (Radix Select). **Nunca** usar `<select>` nativo (no macOS o sistema abre a lista por cima do campo).

- Posição: sempre abaixo do campo (`side=bottom`), alinhado à esquerda, 4px de distância.
- Largura: mínimo = largura do campo.
- Altura: até 320px, nunca além do espaço visível; rola por dentro.
- Camada: Portal no `body`, `z-50` (acima de modais/sheets).
- Campo: mesma altura/borda/raio do `Input`: 44px mobile / 40px desktop, `rounded-lg`, `border-input`.
- Itens: `min-h-9`, destaque `bg-muted`, ✓ no selecionado, grupos via `<optgroup label>`.
- API igual a `<select>`: filhos `<option>`/`<optgroup>`, `value`/`defaultValue`, `onChange(e.target.value)` e `name`.

---

## 10. Instituições (seletor e logo)

- Campo de banco/cartão: `InstitutionInput` (`src/ui/institution.tsx`): combobox com busca por nome ou COMPE, logo à esquerda e nome à direita.
- Lista: ao abrir mostra todas as instituições principais com logo, uma por marca, ordem alfabética. Ao digitar, filtra pelo começo das palavras ou COMPE.
- Afiliadas (cooperativas) só quando o nome delas é digitado.
- Foto do cartão: link https opcional; se não carregar, cai no logo/ícone.
- Logo em qualquer tela: `InstitutionLogo` (mesmo tamanho do `IconBlock`; `size="sm"` em listas). Sem logo → ícone genérico do DS.
- Identificação: ISPB salvo (estável) ou, sem ele, nome exato e único — nunca por semelhança.
- Dados: `logos-bancos-br@0.8.2` (versão fixa). `npm run institutions` regenera `src/lib/institutions.json`.

---

## 11. Abas, filtros e seleção

Dois padrões, sem criar um terceiro para cada tela:

1. **Abas de escopo** (`Tabs`): Todos / Entradas / Saídas / Transferências. Itens conectados em grupo, borda 1px, raios apenas nas extremidades, elemento ativo com fundo sutil. Se muitas abas, scroll **somente** da barra de abas, nunca da página.
2. **Segmentado binário** (`ToggleGroup`/`segmented`): Receita / Despesa, Pago / Pendente. Compacto, visual de campo único, seleção claramente destacada.

- Altura de abas: 36–40px, não 60px.
- Evitar tabs em modais pequenos com várias camadas de navegação.
- Cores semânticas somente se fizerem sentido: Receita verde, Despesa vermelho; "Todos" azul neutro.

---

## 12. Layout por dispositivo

| Largura | Shell | Conteúdo | Regras específicas |
|---------|-------|----------|-------------------|
| 320–767px | Barra inferior 5 destinos + header compacto | 1 coluna | safe-area, nada sob nav; filtros recolhíveis; cards de 100% largura |
| 768–1023px | Sidebar compacta por ícones | 2 colunas quando couber | Texto e ícones com tooltip/label acessível |
| 1024px+ | Sidebar completa | 2–4 colunas conforme card | Área central com max-width; sem cards de largura infinita |

Breakpoints de validação: 320, 360, 390, 768, 1024, 1440px. Testar também landscape e zoom 200%.

Barra mobile: Início, Lançamentos, Cartões, Contas, Mais. Não colocar duas barras inferiores nem FAB por cima da navegação. Conteúdo respeita `safe-area-inset-bottom`.

---

## 13. Padrões de tela

### Dashboard
- Primeiro bloco: "dinheiro livre" + saldo real com distinção clara.
- Em seguida: entradas, saídas, dívida total e próximos vencimentos.
- Um cartão de ação imediata (ex.: contas vencendo) pode ter prioridade sobre gráfico.
- No máximo 1 gráfico principal acima da dobra. Relatórios completos têm página própria.

### Lançamentos
- Título compacto; ação "Novo lançamento" discreta à direita desktop / acessível mobile.
- Busca + filtros; tabs Todos/Entradas/Saídas/Transferências.
- Agrupamento por dia; item com ícone, título, metadados, valor alinhado à direita e status. Excluir não deve ser a ação mais chamativa.
- Desktop: lista/tabela ou grade enxuta, jamais cards de 360px fixos se causarem desperdício ou truncamento.

### Cartões / dívidas
- KPIs: usado, disponível, próxima fatura/vencimento e dívida pendente.
- Mostrar parcelas futuras e pagamentos sem duplicar valores.
- Status e valores dominam; gráficos são opcionais.

### Contas a pagar
- Lista por vencimento, filtro Pendente/Pago/Atrasado e indicação de recorrência/parcela.
- Checklist financeiro com ação de marcar pago, exigindo confirmação adequada se alterar saldo.

### Formulários
- Para operações comuns: página/Sheet compacto ou diálogo de 480px, conforme complexidade.
- Campos relevantes agrupados, máscara BRL, seletor de data curto, erros abaixo dos campos.
- Não criar wizard de 5 passos para cadastrar uma conta simples.

---

## 14. Componentes reutilizáveis prioritários

1. `AppShell` — header, sidebar/barra inferior, content (`src/app/Shell.tsx`)
2. `ThemeToggle` — alternar claro/escuro (`src/lib/theme.ts`)
3. `Button`, `IconButton`, `Input`, `MoneyInput`, `Select`, `DatePicker`, `Field`
4. `FinancialAmount`, `FinancialKpi`, `TransactionRow`, `StatusBadge`
5. `FinancialCard` com variantes `default`, `highlight`, `editorial`, `left-soft`
6. `SegmentedTabs`, `FilterBar`, `SearchField`
7. `Dialog`/`Sheet` adaptativo e compacto
8. `DueDateItem`, `DebtSummary`, `InstallmentProgress`
9. `EmptyState` curto com 1 CTA, `Skeleton`, `Toast`, `ConfirmDialog`
10. Charts via Recharts **somente** nos relatórios que precisam de gráfico.

**shadcn/ui:** instalar e customizar peças necessárias, mantendo variantes em componentes existentes. Radix para semântica/foco; Lucide para ícones. Não construir biblioteca paralela por preferência estética.

---

## 15. Estados, validações e feedback

Toda tela e ação deve prever:

- **Carregando:** skeleton pequeno, sem loader enorme.
- **Vazio:** explicar o que falta e oferecer **uma** próxima ação útil.
- **Erro:** mensagem específica + tentar novamente, sem esconder dados anteriores.
- **Sucesso:** toast discreto; evitar grandes telas de parabéns.
- **Desabilitado:** motivo legível quando necessário.
- **Revisão pendente:** visível e sem contaminar saldos até confirmação (salvo exceção Pagar.me autorizada).

---

## 16. Acessibilidade (WCAG 2.2 AA)

- Contraste texto normal ≥ 4,5:1; componentes gráficos/controles ≥ 3:1 quando aplicável.
- Botão pequeno pode ter alvo tocável maior via padding/área invisível sem parecer gigante. Para toque frequente, alvo recomendado 44×44px.
- Foco visível, navegação por teclado, ESC para diálogo, labels reais, erros ligados aos campos.
- Não depender apenas de vermelho/verde, ícone ou hover para comunicar status.
- Respeitar `prefers-reduced-motion` e tamanhos aumentados de texto.

---

## 17. Performance (objetivos de produto, medir em fluxo real)

- Core Web Vitals percentil 75: **LCP ≤ 2,5s, INP ≤ 200ms, CLS ≤ 0,1** quando houver dados suficientes.
- Rotas carregadas sob demanda; Recharts apenas nas telas que usam gráficos.
- Evitar queries redundantes; cache consistente com TanStack Query; paginação/virtualização em muitas transações.
- Não renderizar todas as faturas/parcelas históricas de uma só vez.
- Ícones individuais por import, imagens otimizadas, zero animação pesada em valores.
- Não adicionar dependência sem necessidade demonstrada; revisar bundle por rota.
- Não bloquear interação por recalcular o mês inteiro a cada tecla digitada.

---

## 18. Checklist visual de aceite (cada tela)

- [ ] Botões e modais dentro do contrato; nenhuma ação exagerada visualmente.
- [ ] Sem scroll horizontal da página (320/360/390/768/1024/1440px).
- [ ] Sem card dentro de card nem espaços vazios desproporcionais.
- [ ] Dark/light consistentes e contrastes conferidos.
- [ ] Valores corretos, alinhados e sem cortar centavos/sinal.
- [ ] Abas, filtros, navegação e formulários operáveis por teclado e toque.
- [ ] Header, barra inferior, sheet e teclado não escondem ações.
- [ ] Loading/erro/vazio/sucesso projetados sem poluição.
- [ ] Sem gráficos inúteis, chamadas redundantes ou grandes re-renderizações.
- [ ] Conferência visual no navegador quando autorizada; não declarar validado só lendo CSS.

---

## 19. Como aplicar

**Primeiro tokens e componentes, depois telas.** Toda nova tela deve escolher componentes e variantes deste Design System. Qualquer exceção deve ter justificativa objetiva e ser aprovada antes de virar um novo padrão.

Os componentes vivem em `src/ui/` e são exportados centralmente. Os tokens vivem em `src/index.css` e devem ser usados via variáveis CSS (`var(--*)`), nunca hexadecimais diretos.

---

## 20. Estrutura de arquivos

```
src/
  index.css          # Tokens CSS (cores, tipografia, raios, utilitários Tailwind v4)
  lib/
    theme.ts         # Controle de tema claro/escuro (localStorage)
    utils.ts         # cn() (class-variance-authority helper)
  ui/
    button.tsx       # Button + buttonVariants
    input.tsx        # Input
    label.tsx        # Label (Radix)
    select.tsx       # Select (Radix, sempre abaixo do campo, z-50)
    toggle.tsx       # Toggle + toggleVariants
    toggle-group.tsx # ToggleGroup + ToggleGroupItem
    tabs.tsx         # Tabs + TabsList + TabsTrigger + TabsContent
    dialog.tsx       # Dialog + DialogContent + DialogHeader + DialogFooter...
    alert-dialog.tsx # AlertDialog + ações + cancelar
    sheet.tsx        # Sheet (diálogo inferior mobile / lateral desktop)
    tooltip.tsx      # Tooltip + TooltipTrigger + TooltipContent
    skeleton.tsx     # Skeleton
    sonner.tsx       # Toaster (toasts com barra de progresso)
    finance.tsx      # Amount, MoneyInput, Field, Page, Panel, IconBlock, ListRow, StatusBadge, OverdraftBadge, EmptyState, CategoryIcon
    category-look.tsx # Ícones e cores por categoria
    index.ts         # Exportação central do Design System
  app/
    Shell.tsx        # AppShell (Sidebar + BottomNav + DataGate)
```

---

**Fim da especificação.** Use este documento como referência única para decisões visuais do Financeiro Diogo.
