#!/bin/sh
# Grava no Vault do Supabase (produção) os 2 valores do alerta de segurança no Telegram (migration 0054):
#   barberia_telegram_token    token do bot (BotFather)
#   barberia_telegram_chat_id  seu chat com o bot (descoberto sozinho pela última mensagem que você mandou ao bot)
# Antes: no Telegram, crie o bot com o @BotFather (/newbot) e mande "oi" para ele.
# O token é digitado sem eco, conferido no Telegram (getMe) e uma mensagem de teste é enviada antes de gravar.
# Nenhum valor é exibido nem fica no repositório. O SQL vai num arquivo temporário (600), apagado no fim; em caso de erro a
# saída da CLI é ocultada (poderia ecoar o SQL). Reexecutar atualiza os valores (não duplica).
# Uso: sh supabase/aplicar/segredos-alerta-telegram.sh
set -eu
REF=hbkbdqctelembzqiptpi

TOKEN=""
printf 'Token do bot do Telegram (não aparece na tela): '
stty -echo 2>/dev/null || true; read -r TOKEN || true; stty echo 2>/dev/null || true; echo
[ -n "$TOKEN" ] || { echo "Token vazio. Nada foi gravado."; exit 1; }

CHAT=$(V_TOKEN="$TOKEN" python3 -I - <<'PY'
import json, os, sys, urllib.request
t = os.environ["V_TOKEN"]
def api(metodo, corpo=None):
    req = urllib.request.Request(f"https://api.telegram.org/bot{t}/{metodo}", data=json.dumps(corpo).encode() if corpo else None,
                                 headers={"Content-Type": "application/json"}, method="POST" if corpo else "GET")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())
try:
    bot = api("getMe")["result"]["username"]
except Exception:
    sys.exit("Token recusado pelo Telegram. Confira o token do @BotFather. Nada foi gravado.")
msgs = [u.get("message") or u.get("edited_message") for u in api("getUpdates").get("result", [])]
chats = [m["chat"]["id"] for m in msgs if m and m.get("chat", {}).get("type") == "private"]
if not chats:
    sys.exit(f"Nenhuma mensagem encontrada. Abra o Telegram, mande \"oi\" para @{bot} e rode de novo. Nada foi gravado.")
chat = chats[-1]
api("sendMessage", {"chat_id": chat, "text": "Barberia: alertas de segurança ligados. Você vai receber aqui os avisos e o resumo diário às 09:00."})
print(chat)
PY
) || exit 1

TMP=$(mktemp)
chmod 600 "$TMP"
trap 'rm -f "$TMP"' EXIT
V_TOKEN="$TOKEN" V_CHAT="$CHAT" python3 -I - "$TMP" <<'PY'
import os, secrets, sys
itens = [("barberia_telegram_token", os.environ["V_TOKEN"]), ("barberia_telegram_chat_id", os.environ["V_CHAT"])]
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
    perform vault.create_secret({q}, '{nome}', 'Alerta de segurança no Telegram (migration 0054)');
  end if;
end $do$;""")
open(sys.argv[1], "w").write("\n".join(partes) + "\n")
PY
if supabase db query --remote="$REF" --yes -f "$TMP" >/dev/null 2>&1; then
  echo "Vault: token e chat do Telegram gravados. A mensagem de teste já deve ter chegado no seu Telegram."
else
  echo "Falha ao gravar no Vault (saída oculta para não expor valores). Nada foi exibido."
  exit 1
fi
