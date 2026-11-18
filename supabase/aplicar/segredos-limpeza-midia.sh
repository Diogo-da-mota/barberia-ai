#!/bin/sh
# Grava no Vault do Supabase (produção) os 3 valores usados pela limpeza diária de mídia (migration 0051):
#   barberia_media_migrate_url     endereço da função media-migrate
#   barberia_anon_key              chave anon (o gateway da função exige um JWT; a chave é pública)
#   barberia_media_migrate_secret  segredo MEDIA_MIGRATE_SECRET (cabeçalho x-migrate-secret), lido do Keychain
# Nenhum valor é exibido nem fica no repositório. O segredo do Keychain é conferido com a impressão digital (SHA-256) do
# MEDIA_MIGRATE_SECRET publicado nas Edge Functions antes de gravar. O SQL vai num arquivo temporário (600), apagado no fim;
# em caso de erro a saída da CLI é ocultada (poderia ecoar o SQL). Reexecutar atualiza os valores (não duplica).
# Uso: sh supabase/aplicar/segredos-limpeza-midia.sh
set -eu
REF=hbkbdqctelembzqiptpi

MEDIA_SECRET=$(security find-generic-password -s barberia-media-migrate -w) || { echo "Keychain: item barberia-media-migrate não encontrado"; exit 1; }
DIGEST=$(supabase secrets list --remote="$REF" -o json 2>/dev/null | python3 -c 'import json,sys; print(next((x.get("value","") for x in json.load(sys.stdin) if x["name"]=="MEDIA_MIGRATE_SECRET"), ""))')
LOCAL=$(printf '%s' "$MEDIA_SECRET" | shasum -a 256 | cut -d' ' -f1)
if [ -z "$DIGEST" ] || [ "$DIGEST" != "$LOCAL" ]; then
  echo "O segredo do Keychain não confere com o MEDIA_MIGRATE_SECRET publicado. Nada foi gravado."
  exit 1
fi
ANON=$(supabase projects api-keys --remote="$REF" -o json 2>/dev/null | python3 -c 'import json,sys; print(next(k["api_key"] for k in json.load(sys.stdin) if k.get("name")=="anon"))')
URL="https://$REF.supabase.co/functions/v1/media-migrate"

TMP=$(mktemp)
chmod 600 "$TMP"
trap 'rm -f "$TMP"' EXIT
V_URL="$URL" V_ANON="$ANON" V_SECRET="$MEDIA_SECRET" python3 - "$TMP" <<'PY'
import os, secrets, sys
itens = [("barberia_media_migrate_url", os.environ["V_URL"]), ("barberia_anon_key", os.environ["V_ANON"]),
         ("barberia_media_migrate_secret", os.environ["V_SECRET"])]
partes = []
for nome, valor in itens:
    tag = "v" + secrets.token_hex(8)
    while f"${tag}$" in valor:
        tag = "v" + secrets.token_hex(8)
    q = f"${tag}${valor}${tag}$"
    partes.append(f"""do $do$ begin
  if exists (select 1 from vault.secrets where name = '{nome}') then
    perform vault.update_secret((select id from vault.secrets where name = '{nome}'), {q});
  else
    perform vault.create_secret({q}, '{nome}', 'Limpeza diária de mídia (migration 0051)');
  end if;
end $do$;""")
open(sys.argv[1], "w").write("\n".join(partes) + "\n")
PY
if supabase db query --remote="$REF" --yes -f "$TMP" >/dev/null 2>&1; then
  echo "Vault: 3 valores gravados (url, chave anon e segredo da media-migrate)."
else
  echo "Falha ao gravar no Vault (saída oculta para não expor valores). Nada foi exibido."
  exit 1
fi
