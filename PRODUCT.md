# PRODUCT.md — Barberia AI

Regras de produto do núcleo de agendamento (MVP e expansões). Fonte: `PLANO_IMPLEMENTACAO.md` (seções 5–6) e `Segurança.md`.

## 1. Papéis e isolamento

| Papel | Pode fazer | Não pode fazer |
|---|---|---|
| Proprietário | Configurar empresa, equipe, serviços, agenda, financeiro e permissões | Ler/alterar dados de outra empresa |
| Gerente | Operar agenda, equipe e clientes conforme permissão concedida | Tornar-se proprietário sozinho ou acessar outras empresas |
| Barbeiro | Consultar própria agenda, histórico e ganhos; editar horários se autorizado | Consultar ganhos de outros barbeiros sem permissão |
| Cliente | Consultar próprios agendamentos; solicitar alterações permitidas | Acessar dados internos, financeiros ou de terceiros |

- Uma conta pode pertencer a mais de um estabelecimento, com **papel por estabelecimento**.
- Proprietário é atribuído apenas por fluxo de criação de empresa validado no servidor.
- Nunca confiar em `user_metadata`, `role`, `barbershop_id` ou `user_id` enviados pelo cliente.

## 2. Empresas, profissionais e serviços

- Empresa: nome, slug único (página pública), endereço, telefone, descrição, timezone IANA, dias/horas de funcionamento, identidade visual, status.
- Profissional: vínculo à empresa e, quando aplicável, conta autenticada; nome, foto, contatos, serviços habilitados, agenda individual, intervalos, folgas, comissões.
- Serviço: nome, descrição, preço em centavos, duração positiva em minutos, ativo/inativo, profissionais elegíveis.

## 3. Agendamento

- Cliente escolhe empresa → serviço → profissional específico ou **qualquer disponível** → data → horário.
- O slot exibido **não é garantia**; o servidor recalcula na confirmação.
- Reserva criada em **uma transação PostgreSQL**: autorização, cliente, profissional, limite e conflitos.
- O banco impede dois intervalos sobrepostos para o mesmo profissional (dez requisições concorrentes → 1 reserva ativa).
- Dois profissionais podem atender simultaneamente; intervalos contíguos são válidos.
- Bloqueios e reservas ocupam o mesmo recurso (`tstzrange [início, fim)` + `EXCLUDE USING gist`).
- Instantes em UTC (`timestamptz`); conversão na UI pelo timezone IANA da empresa.
- Snapshot de preço, duração e nome do serviço gravado na criação.
- Estados: `pendente`, `confirmado`, `concluído`, `cancelado`, `não_compareceu`. Transições validadas no servidor.
- Limite: **três reservas futuras ativas por cliente, por empresa** (aplicado atomicamente).
- Reagendamento libera o antigo e ocupa o novo sem janela de inconsistência; histórico de cancelamento preservado.

## 4. Identidade do cliente (MVP)

- Catálogo e horários públicos; para concluir agendamento, consultar histórico, cancelar ou reagendar exigir sessão autenticada (Google/Supabase) com vínculo validado à reserva.
- Cadastro solicita nome e WhatsApp para contato; telefone digitado não comprova titularidade.
- Consentimento separado para avisos de reserva e para marketing; opt-out auditável.

## 5. Financeiro (fase posterior)

- Valores em centavos inteiros; nunca ponto flutuante para saldos.
- Forma de pagamento declarada (PIX/dinheiro/débito/crédito), sem fingir confirmação de gateway não integrado.
- Idempotência e transações atômicas; impedir duplicidade de pagamento/estorno/repasse.
- RLS financeira: barbeiro vê apenas seus ganhos; isolamento entre empresas.

## 6. Proibições de produto

- Next.js, NextAuth, Prisma; frontend e backend como projetos isolados; credenciais de servidor no navegador.
- Serviços pagos criados sem autorização; deploy/migration remota sem autorização explícita.
- Simular login real, pagamentos ou entrega de WhatsApp sem integração autorizada.
