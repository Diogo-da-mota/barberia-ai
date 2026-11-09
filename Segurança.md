# SEGURANÇA.md — BARBERIA AI

## OBJETIVO

Implementar segurança desde o início no projeto:

`/Users/diogomota/Documents/GitHub/Barberia AI`

**Stack:** React + Vite + TypeScript + Supabase + Edge Functions.

Utilize as skills **Superpowers** e as skills de segurança disponíveis para implementar e testar as proteções.

## 1. Autenticação Google

- Supabase Auth com Google OAuth.
- Validar identidade e sessão no backend.
- Proteger rotas administrativas.
- Implementar logout e expiração de sessão.
- Nunca confiar somente nas verificações do frontend.
- Não utilizar `user_metadata` editável para definir permissões.
- Não permitir que clientes se promovam a administradores.

## 2. Proteção do banco de dados

- Ativar Row Level Security (RLS) nas tabelas expostas.
- Isolar dados por `barbershop_id`.
- Validar proprietário, gerente, barbeiro e cliente.
- Implementar políticas de SELECT, INSERT, UPDATE e DELETE.
- Proteger contra acesso entre estabelecimentos.
- Utilizar foreign keys, constraints e índices adequados.
- Testar todas as permissões com usuários reais de teste.

## 3. Segurança das Edge Functions

- Validar JWT e identidade do usuário.
- Verificar permissões em cada operação.
- Validar entradas com Zod ou equivalente.
- Implementar rate limiting.
- Utilizar idempotência nas operações críticas.
- Nunca confiar em `userId`, `role` ou `barbershopId` enviados pelo cliente sem verificar autorização.
- Não expor erros internos, SQL ou credenciais nas respostas.

## 4. Segurança dos agendamentos

- Impedir reservas sobrepostas para o mesmo profissional.
- Permitir atendimentos simultâneos com profissionais diferentes.
- Validar disponibilidade dentro de transações PostgreSQL.
- Utilizar constraints de exclusão e locks quando necessários.
- Impedir conflitos entre reservas, bloqueios e reagendamentos.
- Preservar histórico de cancelamentos.
- Garantir que alterar a duração do serviço não modifique reservas antigas.

## 5. Segurança financeira

- Registrar valores em centavos inteiros.
- Impedir pagamentos e repasses duplicados.
- Validar saldo antes de receber, estornar ou repassar.
- Utilizar transações atômicas.
- Manter histórico de operações e estornos.
- Impedir que barbeiros consultem ganhos de outros profissionais.
- Impedir que uma barbearia consulte informações financeiras de outra.

## 6. Credenciais e variáveis de ambiente

Arquivo existente:

`/Users/diogomota/Documents/GitHub/Barberia AI/.env`

Regras:

- Nunca apagar ou sobrescrever o `.env`.
- Não imprimir credenciais nos logs.
- Não incluir `.env` no Git.
- Criar `.env.example` sem valores secretos.
- Expor no Vite somente chaves publicáveis.
- Manter `service_role`, senhas e segredos exclusivamente no ambiente protegido.
- Não copiar credenciais de outros projetos.

Projeto Supabase autorizado:

`hbkbdqctelembzqiptpi`

## 7. Uploads e AWS S3

- Validar tipo e tamanho dos arquivos.
- Impedir uploads não autorizados.
- Utilizar URLs assinadas quando necessário.
- Restringir permissões dos buckets.
- Não expor credenciais AWS no navegador.
- Proteger arquivos privados.

## 8. WhatsApp, n8n e webhooks

- Autenticar e validar a origem dos webhooks.
- Utilizar assinaturas HMAC quando aplicável.
- Proteger contra mensagens e eventos duplicados.
- Implementar idempotência e retentativas controladas.
- Registrar falhas sem expor dados sensíveis.
- Respeitar consentimento e regras de comunicação.

## 9. Testes obrigatórios

Implementar testes para:

- Cliente tentando acessar o painel administrativo.
- Barbeiro tentando acessar dados de outro barbeiro.
- Empresa tentando consultar dados de outra empresa.
- Usuário tentando alterar seu próprio papel.
- Reserva duplicada com dez chamadas simultâneas.
- Conflitos entre bloqueios e reservas.
- Pagamento e repasse simultâneos.
- Tentativas de acessar Edge Functions sem autorização.
- Upload inválido ou não autorizado.
- Webhooks repetidos ou com assinatura inválida.

## 10. Regras de execução

1. Utilizar Superpowers para planejar, implementar e verificar.
2. Criar testes antes das regras críticas.
3. Implementar uma proteção por vez.
4. Executar testes de regressão após cada alteração.
5. Não modificar o design durante tarefas de segurança.
6. Não executar migrations remotas sem autorização.
7. Não apagar dados reais.
8. Não fazer commit, push ou deploy automaticamente.
9. Máximo de três tentativas por erro.
10. Registrar impedimentos e continuar tarefas independentes.
11. Não declarar segurança comprovada sem testes.

## 11. Checklist de conclusão

- [ ] Google OAuth configurado e testado.
- [ ] Sessões e permissões protegidas.
- [ ] RLS implementada e testada.
- [ ] Isolamento multiempresa validado.
- [ ] Edge Functions protegidas.
- [ ] Agendamentos protegidos contra concorrência.
- [ ] Financeiro transacional.
- [ ] Credenciais protegidas.
- [ ] Uploads seguros.
- [ ] Webhooks autenticados.
- [ ] Rate limiting e idempotência validados.
- [ ] Testes de segurança aprovados.

## ENTREGA

Crie e mantenha `SEGURANÇA.md` atualizado.

Para cada item concluído, informe a implementação e os testes que comprovam seu funcionamento.

**Não faça somente uma auditoria: implemente as proteções e valide cada uma, sem alterar o design.**