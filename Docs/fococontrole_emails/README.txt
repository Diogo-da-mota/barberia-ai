FOCO CONTROLE — Modelos de e-mail para Supabase Auth

Templates de confirmação, recuperação, convite, acesso mágico e troca de e-mail.
Os arquivos templates/*.html contêm o marcador oficial {{ .ConfirmationURL }}.
Os arquivos previas/*.html contêm um link de demonstração para visualização local.

A configuração usa a Management API de Supabase, NÃO executa migrações e NÃO muda o banco.
O script requer token pessoal de acesso Supabase e chave API Resend, ambos digitados sem eco.
O script não grava as credenciais no disco e não altera outras configurações além do envio e templates.

Comando depois de descompactar:
  python3 configurar_email.py

URLs oficiais:
https://supabase.com/docs/guides/auth/auth-smtp
https://supabase.com/docs/guides/auth/auth-email-templates
https://resend.com/docs/send-with-smtp
