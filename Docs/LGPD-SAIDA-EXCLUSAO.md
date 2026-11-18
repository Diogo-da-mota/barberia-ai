# Saída da barbearia e exclusão de conta — política de dados (LGPD)

> Documento técnico de apoio. **Não é parecer jurídico** e não afirma conformidade integral com a LGPD: prazos, bases legais e o papel de cada agente de tratamento precisam de revisão por profissional especializado. Implementação: migration `0057_saida_exclusao_equipe.sql` (testes em `supabase/tests/sair-excluir-conta.test.ts`).

## 1. Fundamento consultado

- **Art. 15** (término do tratamento): finalidade alcançada, fim do período, **pedido do titular** (inc. III) ou determinação da ANPD.
- **Art. 16** (eliminação após o término), com conservação autorizada para: **I – cumprimento de obrigação legal ou regulatória**; II – estudo por órgão de pesquisa (anonimizado); III – transferência a terceiro; **IV – uso exclusivo do controlador, vedado o acesso por terceiro, e desde que anonimizados**.
- **Art. 18**: confirmação, acesso, correção, **anonimização/bloqueio/eliminação de dados desnecessários** (IV), **eliminação dos tratados com consentimento** (VI), revogação do consentimento (IX). §4º: se não for possível atender de imediato, responder indicando as razões. §5º: atendimento sem custo, **nos prazos previstos em regulamento**. §6º: comunicar aos agentes com quem os dados foram compartilhados.
- **Art. 19, II**: declaração completa de confirmação/acesso em até 15 dias. Até 18/11/2026 não localizamos regulamento final da ANPD com prazo para eliminação (o tema "Direitos dos titulares" está na agenda regulatória). Prazo interno sugerido: **15 dias** — decisão pendente.

Fontes: [Lei 13.709/2018 (Planalto)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), [ANPD – Direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares).

## 2. Papéis (hipótese de trabalho, a validar)

| Dado | Controlador provável | Barberia AI |
|---|---|---|
| Conta (login, perfil, preferências, consentimentos, sessões) | Barberia AI | controlador |
| Cadastro do profissional na barbearia (nome, foto, telefone, e-mail, CPF/CNPJ), agenda, comissões, repasses, pagamentos | a barbearia | operador |
| Reservas e dados dos clientes da barbearia | a barbearia | operador |

Consequência: a exclusão da conta apaga o que é da plataforma e **não apaga registros que a barbearia precisa guardar**; nesses, remove a ligação com a conta e o que não tem finalidade.

## 3. Sair da barbearia (`leave_barbershop`)

A conta continua. Só a barbearia escolhida é afetada.

| Dado | O que acontece | Por quê |
|---|---|---|
| Vínculo de equipe (`memberships`) | **apagado** | fim da relação; o acesso termina na hora (o papel nunca está no token) |
| Card do profissional | **inativo, sem conta, marcado `desligado_em`**; nome, foto, contato e documento ficam com a barbearia | histórico de atendimentos e financeiro da barbearia (controladora) |
| Reservas futuras do card | **ficam com a barbearia** para reagendar com outro profissional ou cancelar; o cliente não é avisado automaticamente | a reserva é um compromisso da barbearia com o cliente |
| Reservas passadas, pagamentos, estornos, comissões, repasses, razão | **conservados sem alteração** | art. 16, I (fiscal/trabalhista da barbearia) |
| Google Agenda do card | **desconectado**: refresh token apagado, conexão desvinculada, sincronizações pendentes canceladas | integração pessoal sem finalidade |
| Convites pendentes para o e-mail na barbearia | **expiram** | convite antigo não devolve acesso sem nova decisão |
| Reservas como cliente e outras barbearias | **sem mudança** | não fazem parte do vínculo encerrado |

Reativar o card sem conta ligada é recusado (`professional_left`); um novo convite aceito religa o mesmo card.

## 4. Excluir minha conta (`delete_my_account`)

Exige **login recente (15 min)**, conferido no servidor pelo `amr` do token assinado pelo Supabase, contando só o **primeiro fator** (senha, Google, código/link do e-mail): um fator de MFA cadastrado com a sessão já aberta não vale, nem horário no futuro. Tudo numa **única transação** com a exclusão em `auth.users`, com a linha do perfil travada (aceite de convite, vínculo de card e reservas esperam): ou tudo acontece, ou nada.

| Dado | Tratamento | Base / critério | Acesso depois |
|---|---|---|---|
| Login, identidades, sessões e refresh tokens (`auth.*`) | **excluído** (cascata) | art. 18, VI | — |
| Perfil (nome, e-mail, foto do Google, WhatsApp), preferências, cor | **excluído** | art. 18, VI | — |
| Consentimentos e histórico de consentimento | **excluído** (cascata) | ver pendência P4 | — |
| Vínculos com barbearias | **excluído** | fim da relação | — |
| Card do profissional: foto, telefone, e-mail | **excluído**, inclusive nos cards de barbearias de onde a pessoa já tinha saído (mesmo e-mail confirmado); a foto sai do S3 pela limpeza diária de órfãos (envios a partir da 0041) | sem finalidade após a saída | — |
| Card do profissional: **nome** e **CPF/CNPJ** | **conservados**, card inativo e sem conta | art. 16, I: comissões e repasses precisam identificar quem recebeu | só gestão da barbearia (CPF só via `get_professional_contacts`) |
| Reservas atendidas pelo profissional | **conservadas** | histórico e financeiro da barbearia | gestão da barbearia |
| Reservas em que a pessoa foi **cliente** | **anonimizadas**: sem dono, "Cliente removido", sem WhatsApp e e-mail | financeiro da barbearia (art. 16, I), sem identificar | gestão da barbearia |
| Avisos de WhatsApp (`outbox_events`) | **anonimizados**: sem telefone e texto; pendentes cancelados | — | — |
| Convites pendentes ao e-mail | **excluídos**; convites aceitos e os registros `invite.created/renewed` do log ficam com e-mail `removido` | sem finalidade | gestão |
| Pagamentos, estornos, comissões, repasses, razão | **conservados** sem ligação com a conta (`registrado_por` vira nulo) | art. 16, I | gestão |
| Autoria em logs (`audit_logs`, `booking_events`, `media_uploads`) | **id da conta removido** (nulo) | trilha de auditoria da barbearia sem identificar | gestão |
| Registro do atendimento (`account_deletion_requests`) | **conservado sem identificar a pessoa** (data, origem, situação) | responsabilização (art. 6º, X) | ninguém pela API |

Recusas que **não impedem o pedido**: dono de barbearia (`owner_cannot_delete`) e reserva futura como cliente (`has_upcoming_bookings`). Nesses casos a tela oferece **Registrar pedido de exclusão** (`request_account_deletion`): um pedido pendente por conta, com o motivo calculado no servidor, atendido manualmente (OPERACAO.md).

## 5. Sistemas externos e backups

| Onde | Situação após a exclusão | Ação |
|---|---|---|
| Backups do Supabase (diários/PITR) | o dado permanece até a rotação do backup | não restaurar backup sem reaplicar as exclusões registradas; prazo de rotação a confirmar no plano |
| Log de auditoria do Supabase Auth (`auth.audit_log_entries`) e fluxos OAuth pendentes (`auth.flow_state`) | podem conter e-mail e IP | geridos pelo Supabase; limpeza manual pendente (P6) |
| Google Agenda da pessoa | eventos já criados ficam na agenda dela; o token é apagado, mas não revogado no Google | a pessoa pode revogar em myaccount.google.com; revogação automática pendente (P7) |
| WhatsApp (Evolution) e celulares dos clientes | mensagens já enviadas não voltam | — |
| S3 (fotos) | foto de envio anterior à 0041 não entra na limpeza automática | remoção manual pela função `media` (gestão) |
| Telegram (alertas) | só contagens, sem dados pessoais | — |

## 5a. Retenção — proposta (a validar pelo jurídico; nada disto é expurgado automaticamente hoje)

| Dado conservado | Finalidade | Critério proposto | Ao fim do prazo |
|---|---|---|---|
| Nome e CPF/CNPJ do profissional no card desligado; comissões e repasses ligados ao card | prova de pagamentos e obrigações fiscais/contábeis da barbearia (art. 16, I) | 5 anos contados de 1º de janeiro do ano seguinte ao último lançamento financeiro do card (referência: CTN, art. 173, I, e art. 195, parágrafo único); se houver vínculo de emprego, o prazo maior entre esse e o da CF, art. 7º, XXIX (2 anos após o fim do contrato) | nome vira "Profissional removido" e o documento é apagado; valores ficam |
| Reservas anonimizadas ("Cliente removido") e lançamentos financeiros sem a conta | histórico e caixa da barbearia | sem prazo da LGPD: dado anonimizado não é dado pessoal (art. 12), desde que não haja como reidentificar | — |
| Pedido de exclusão concluído (`account_deletion_requests`, sem a pessoa) | prestação de contas (art. 6º, X) | 5 anos | apagar |
| Pedido de exclusão pendente | atendimento manual | até ser atendido; resposta em até 15 dias (proposta, P2) | concluir ou cancelar |
| Backups do Supabase | recuperação de desastre | rotação do plano contratado (a confirmar) | some na rotação; restaurar exige reaplicar as exclusões |

Acesso aos dados conservados: só a gestão da barbearia lê o card desligado; o CPF/CNPJ só sai por `get_professional_contacts` (proprietário e gerente). Nenhuma conta da equipe desligada, nem o titular, enxerga esses registros pela API.

## 6. Pendências que dependem de decisão jurídica ou de produto

- **P1** Prazo de conservação do nome/CPF do profissional e das reservas anonimizadas (fiscal 5 anos? trabalhista 2 anos após o fim da relação?) e rotina de anonimização ao fim do prazo.
- **P2** Prazo de resposta aos pedidos manuais (sugestão: 15 dias) e canal oficial (e-mail do encarregado).
- **P3** Transferência de propriedade da barbearia (hoje só pelo suporte; não existe fluxo no produto).
- **P4** Guardar prova de consentimento/revogação após a exclusão (hoje é apagada junto com a conta).
- **P5** Avisar automaticamente clientes e gestão quando um profissional sai com reservas futuras.
- **P6** Limpeza do log de auditoria do Supabase Auth.
- **P7** Revogar o token no Google ao desconectar a agenda.
- **P8** Dados do card (telefone/e-mail) na **saída** sem exclusão de conta: hoje ficam com a barbearia (controladora); revisar se o profissional pode pedir a remoção à barbearia pelo produto.
- **P10** Reautenticação pelo Google: com o Google já aberto no navegador basta escolher a conta (`prompt=select_account`); o servidor não confere `auth_time` do Google. Aceitar o risco ou exigir senha/código.
- **P11** Ligar **Require current password when changing password** no Supabase Auth (Authentication › Providers › Email). Só *Secure password change* não basta: pela documentação, uma sessão criada há menos de 24 h troca a senha sem código, entra com a senha nova e passa pela reautenticação da exclusão. Antes de ligar, testar num projeto de teste se *Esqueci minha senha* (`updatePassword`) continua funcionando. Conferir também **Secure email change** ligado (padrão) e o login por telefone desligado.
- **P9** Gerente sai pela API, mas o botão **Sair da barbearia** só aparece na versão curta de Mais (barbeiro); decidir se a gestão também ganha o card Conta.
