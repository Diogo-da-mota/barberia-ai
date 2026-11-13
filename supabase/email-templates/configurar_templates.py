#!/usr/bin/env python3
"""Barberia AI — diagnóstico do envio de e-mails do Supabase Auth e aplicação SÓ dos modelos "Confirm signup" e "Reset password".

Não mexe em banco, migrations, SMTP, URLs nem em outros modelos. Faz backup dos modelos atuais antes de mudar.
Token: variável SUPABASE_ACCESS_TOKEN ou digitado sem eco (conta dona do projeto; https://supabase.com/dashboard/account/tokens).
Nunca imprime o token, a senha do SMTP nem respostas brutas da API; e-mails e códigos nos logs saem mascarados.

  python3 supabase/email-templates/configurar_templates.py --verificar # diagnóstico + backup, não altera nada
  python3 supabase/email-templates/configurar_templates.py             # diagnóstico, backup e pergunta antes de aplicar
"""
from __future__ import annotations

import getpass
import json
import os
import re
import smtplib
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_REF = "hbkbdqctelembzqiptpi"
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}"
HERE = Path(__file__).resolve().parent
MODELOS = {
    "confirmation": ("Confirme seu e-mail | Barberia", "#token_hash={{ .TokenHash }}&type=email"),
    "recovery": ("Redefina sua senha | Barberia", "#token_hash={{ .TokenHash }}&type=recovery"),
}
# Endereço que o app manda como redirect_to (callbackUrl em src/features/auth/services/auth.ts)
CALLBACK = "/auth/callback?area=cliente&tipo=recuperar&volta=%2Fbarbearia%2Fminhas-reservas"
_token = ""


def call(method: str, path: str = "/config/auth", payload: dict | None = None) -> dict:
    global _token
    _token = _token or os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip() or getpass.getpass("Token de acesso do Supabase (oculto): ").strip()
    headers = {"Authorization": "Bearer " + _token, "Accept": "application/json", "User-Agent": "barberia-email-templates"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(API + path, method=method, headers=headers, data=data), timeout=40) as res:
            body = res.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        try:
            msg = str(json.loads(exc.read()).get("message", ""))[:300]  # só a mensagem curta
        except Exception:
            msg = ""
        raise SystemExit(f"A API recusou o {method} {path.split('?')[0]}: HTTP {exc.code}. {msg}")
    except urllib.error.URLError:
        raise SystemExit("Sem acesso à API do Supabase. Confira a conexão.")


def mascarar(texto: str) -> str:
    texto = re.sub(r"[\w.+-]+@([\w-]+\.[\w.-]+)", r"***@\1", texto)
    texto = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "*.*.*.*", texto)
    return re.sub(r"[A-Za-z0-9_\-]{24,}", "***", texto)


def permitido(url: str, site_url: str, allow: list[str]) -> bool:
    """Regra do Supabase Auth: mesmo host da Site URL, ou um padrão da lista (`*` não passa de . ou /; `**` passa)."""
    host = lambda u: re.sub(r"^[a-z]+://([^/:?#]+).*$", r"\1", u)
    if site_url and host(url) == host(site_url):
        return True
    for p in allow:
        rx = re.escape(p.strip()).replace(r"\*\*", ".*").replace(r"\*", r"[^./]*")
        if p.strip() and re.fullmatch(rx, url):
            return True
    return False


assert permitido("http://localhost:5173" + CALLBACK, "https://x.com", ["http://localhost:5173/**"])
assert not permitido("http://localhost:5173" + CALLBACK, "https://x.com", ["http://localhost:5173/auth/callback"])
assert mascarar("to maria+1@gmail.com ip 10.0.0.1") == "to ***@gmail.com ip *.*.*.*"


def diagnostico_smtp(cfg: dict) -> None:
    host, port = cfg.get("smtp_host"), str(cfg.get("smtp_port") or "")
    print("\n[Envio]")
    if not host:
        print("SMTP próprio: NÃO. Usa o envio padrão do Supabase: só entrega para e-mails da equipe do projeto e no máx. 2 por hora.")
        return
    remetente = str(cfg.get("smtp_admin_email") or "")
    print(f"SMTP próprio: {host}:{port} | usuário: {cfg.get('smtp_user') or '(vazio)'} | remetente: {remetente or '(vazio)'} | nome: {cfg.get('smtp_sender_name') or '(vazio)'}")
    print("Senha do SMTP: não é exibida (a API não a devolve).")
    print("Intervalo mínimo por usuário (s):", cfg.get("smtp_max_frequency"), "| limite de e-mails por hora:", cfg.get("rate_limit_email_sent"))
    try:
        ctx = ssl.create_default_context()
        if port == "465":
            s = smtplib.SMTP_SSL(host, 465, timeout=12, context=ctx)
        else:
            s = smtplib.SMTP(host, int(port or 587), timeout=12)
            s.ehlo()
            s.starttls(context=ctx)
        s.ehlo()
        s.quit()
        print("Conexão e TLS com o servidor SMTP: OK (a senha só é testada pelo próprio Supabase ao enviar).")
    except Exception as exc:
        print("Conexão com o servidor SMTP FALHOU:", type(exc).__name__, mascarar(str(exc))[:160])
    dominio = remetente.split("@")[-1] if "@" in remetente else ""
    if "resend" in str(host) and dominio:
        try:
            dkim = subprocess.run(["dig", "+short", "TXT", f"resend._domainkey.{dominio}"], capture_output=True, text=True, timeout=10).stdout.strip()
            print(f"DNS do domínio {dominio} (DKIM do Resend):", "encontrado" if dkim else "AUSENTE — o Resend recusa remetente de domínio não verificado")
        except Exception:
            print("DNS: não foi possível consultar (dig).")


def logs_de_envio() -> None:
    print("\n[Logs do Auth, últimas 24 h — erros e envios de e-mail]")
    fim = datetime.now(timezone.utc)
    sql = ("select timestamp, event_message from auth_logs "
           "where regexp_contains(event_message, '(?i)mail|smtp|recover|/verify|rate limit') order by timestamp desc limit 25")
    q = urllib.parse.urlencode({"sql": sql, "iso_timestamp_start": (fim - timedelta(hours=24)).isoformat(), "iso_timestamp_end": fim.isoformat()})
    try:
        linhas = call("GET", f"/analytics/endpoints/logs.all?{q}").get("result") or []
    except SystemExit as exc:
        print("Logs indisponíveis:", exc)
        return
    if not linhas:
        print("(nenhum registro)")
    for linha in linhas:
        quando = datetime.fromtimestamp(int(linha.get("timestamp", 0)) / 1_000_000).strftime("%d/%m %H:%M:%S")
        bruto = str(linha.get("event_message") or "")
        try:
            ev = json.loads(bruto)
            resumo = " | ".join(str(ev[k]) for k in ("level", "status", "method", "path", "msg", "error") if ev.get(k) not in (None, ""))
        except Exception:
            resumo = bruto
        print(quando, "·", mascarar(resumo)[:220])


def main() -> int:
    print(f"\n=== Barberia AI | e-mails do Auth | projeto {PROJECT_REF} ===")
    cfg = call("GET")
    site = str(cfg.get("site_url") or "")
    allow = [u for u in str(cfg.get("uri_allow_list") or "").split(",") if u.strip()]
    print("Site URL:", site or "(vazia)")
    print("Redirect URLs:", ", ".join(allow) or "(nenhuma)")
    print("Validade dos links (s):", cfg.get("mailer_otp_exp"), "| confirmação de e-mail obrigatória:", not cfg.get("mailer_autoconfirm"))
    origens = {"http://localhost:5173"} | ({re.sub(r"(https?://[^/]+).*", r"\1", site)} if site.startswith("http") else set())
    faltando = [o for o in sorted(origens) if not permitido(o + CALLBACK, site, allow)]
    for o in sorted(origens):
        print(f"Retorno {o}/auth/callback?…:", "aceito" if o not in faltando else "NÃO aceito (o Supabase troca pela Site URL e o link quebra)")

    novos = {}
    for kind, (subject, marker) in MODELOS.items():
        html = (HERE / f"{kind}.html").read_text(encoding="utf-8")
        if "{{ .RedirectTo }}" + marker not in html:
            raise SystemExit(f"{kind}.html sem o link com token_hash; nada foi alterado.")
        novos[f"mailer_subjects_{kind}"] = subject
        novos[f"mailer_templates_{kind}_content"] = html
    print("\n[Modelos]")
    for kind in MODELOS:
        atual = str(cfg.get(f"mailer_templates_{kind}_content") or "")
        estado = "novo da Barberia (token_hash)" if atual == novos[f"mailer_templates_{kind}_content"] else "token_hash" if "TokenHash" in atual else "padrão/antigo (ConfirmationURL)"
        print(f"{kind}: {estado} | assunto: {cfg.get(f'mailer_subjects_{kind}')!r}")

    diagnostico_smtp(cfg)
    logs_de_envio()

    (HERE / "backup").mkdir(exist_ok=True)
    backup = HERE / "backup" / f"auth-email-templates-{datetime.now():%Y-%m-%d-%H%M%S}.json"
    keep = {k: v for k, v in cfg.items() if k.startswith(("mailer_subjects_", "mailer_templates_"))}
    backup.write_text(json.dumps(keep, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nBackup dos modelos atuais:", backup.relative_to(HERE.parent.parent))

    if "--verificar" in sys.argv:
        print("Só verificação: nada foi alterado.")
        return 0
    if faltando:
        print("\nAdicione em Authentication → URL Configuration → Redirect URLs: " + ", ".join(o + "/auth/callback**" for o in faltando))
        print("Nada foi alterado.")
        return 2
    if input("\nDigite APLICAR para trocar só 'Confirm signup' e 'Reset password': ").strip() != "APLICAR":
        print("Cancelado. Nada foi alterado.")
        return 0

    call("PATCH", payload=novos)
    atual = call("GET")
    diferentes = [k for k, v in novos.items() if atual.get(k) != v]
    if diferentes:
        print("\nO Supabase respondeu, mas NÃO gravou:", ", ".join(diferentes))
        print("No plano Free com o SMTP padrão (projeto criado depois de 3/6/2026) os modelos ficam bloqueados; com SMTP próprio, liberam.")
        return 4
    print("\nSUCESSO: os 2 modelos foram gravados e conferidos na API (o restante não foi tocado).")
    print("Para desfazer: aplique os campos do backup acima pelo mesmo endpoint.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
