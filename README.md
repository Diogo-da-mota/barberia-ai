# Barberia AI

SaaS multiempresa de agendamento e gestão de barbearias.

## Documentos do projeto

- `PLANO_IMPLEMENTACAO.md` — escopo, fases, arquitetura e critérios de aceite
- `Segurança.md` — requisitos obrigatórios de autenticação, autorização, banco, Edge Functions e testes
- `Design Sytem.md` — identidade visual, tokens e componentes (referência única de UI)
- `PRODUCT.md` — regras de produto do núcleo de agendamento
- `CHECKLIST.md` — tarefas, status e evidências

## Stack

- Frontend: React 19 + TypeScript + Vite, React Router, TanStack Query, Tailwind CSS v4, shadcn/ui sobre Radix UI, sonner
- Backend: Supabase (PostgreSQL, Auth com Google OAuth, Edge Functions)
- Testes: Vitest, Testing Library, jsdom (unit); pgTAP (RLS); E2E planejado

## Scripts

```bash
npm install        # instalar dependências
npm run dev        # servidor de desenvolvimento (http://localhost:5173)
npm run build      # typecheck + build de produção
npm run lint       # ESLint
npm test           # testes unitários (Vitest)
```

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha com os valores do projeto Supabase autorizado (`hbkbdqctelembzqiptpi`). Nunca commite `.env` e nunca exponha seus valores.

```bash
cp .env.example .env
```

## Operação e release

Setup completo, itens que dependem de contas externas, segredos, incidentes e limitações: [`OPERACAO.md`](OPERACAO.md).

## Regras de execução (resumo)

- Uma tarefa verificável por vez, na ordem do `CHECKLIST.md`.
- Não fazer commit, push, deploy ou migrations remotas sem autorização explícita.
- Segurança desde o primeiro módulo: RLS, validação de entrada no servidor, nunca confiar no payload do cliente.
- Testes proporcionais ao risco; nada declarado como pronto sem teste aprovado.
