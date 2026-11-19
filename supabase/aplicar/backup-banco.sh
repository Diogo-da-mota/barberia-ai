#!/bin/sh
# Cópia completa do banco de produção (papéis, estrutura e dados) para ~/Backups/barberia/<data-hora>/, pasta só sua (700).
# Usa o pg_dump do Postgres.app e o acesso temporário que o Supabase CLI cria a cada execução (nenhuma senha fica guardada).
# Só lê o banco: não altera nada na produção. A cópia tem dados pessoais de clientes: nunca coloque no repositório nem em
# nuvem sem criptografia. Fotos ficam no S3 e não entram nesta cópia.
# Uso (no Terminal): sh supabase/aplicar/backup-banco.sh
set -eu
PGBIN=/Applications/Postgres.app/Contents/Versions/latest/bin
[ -x "$PGBIN/pg_dump" ] || { echo "pg_dump não encontrado: instale o Postgres.app (postgresapp.com)."; exit 1; }
REPO=$(cd "$(dirname "$0")/../.." && pwd)
umask 077
DEST="$HOME/Backups/barberia/$(date +%Y-%m-%d-%H%M)"
mkdir -p "$DEST"
chmod 700 "$HOME/Backups" "$HOME/Backups/barberia" "$DEST"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

copiar() { # $1 = arquivo de saída; o resto são as opções do supabase db dump
  arquivo=$1
  shift
  (cd "$REPO" && supabase db dump --remote --dry-run "$@" 2>/dev/null) | sed -n '/^#!\/usr\/bin\/env bash/,$p' > "$TMP"
  [ -s "$TMP" ] || { echo "Falha ao preparar a cópia ($arquivo): confira o login do supabase."; exit 1; }
  PATH="$PGBIN:$PATH" bash "$TMP" > "$DEST/$arquivo"
  : > "$TMP"
  echo "ok: $arquivo"
}

copiar roles.sql --role-only
copiar schema.sql
copiar data.sql --data-only --use-copy
echo "Cópia salva em: $DEST"
ls -lh "$DEST" | tail -n +2
