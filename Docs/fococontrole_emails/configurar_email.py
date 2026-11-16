#!/usr/bin/env python3
"""Configura SMTP Resend e templates de autenticação da Foco Controle no Supabase hospedado.
Sem pacotes externos, sem Docker, sem migrações e sem imprimir senhas/tokens.
"""
from __future__ import annotations

import getpass
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

PROJECT_REF = "lmtqiiteggrwyburkaqu"
EXPECTED_URL = "https://crm.fococontrole.com.br"
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/config/auth"
BASE = Path(__file__).resolve().parent
SUBJECTS = {
    "confirmation": "Confirme seu e-mail | Foco Controle",
    "recovery": "Redefina sua senha | Foco Controle",
    "invite": "Você foi convidado | Foco Controle",
    "magic_link": "Seu link de acesso | Foco Controle",
    "email_change": "Confirme a alteração de e-mail | Foco Controle",
}


def request(method: str, token: str, payload: dict | None = None) -> dict:
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        API,
        method=method,
        headers=headers,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None,
    )
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        # Nunca imprime o corpo da API: por precaução, mensagens podem conter valores confidenciais.
        raise RuntimeError(f"A API do Supabase recusou a operação: HTTP {exc.code}.") from None
    except urllib.error.URLError as exc:
        raise RuntimeError("Não foi possível acessar a API do Supabase. Confira a conexão.") from None


def main() -> int:
    print("\n=== Foco Controle | E-mails de autenticação ===")
    print(f"Projeto ALVO (único): {PROJECT_REF}")
    print("Não altera banco, EasyPanel, login nem organizações.")
    print("Token pessoal de acesso em: https://supabase.com/dashboard/account/tokens")
    print("\nAtenção: use um Access Token da sua conta Supabase, NÃO a service_role/anon key.")
    token = __import__("subprocess").check_output(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], text=True).strip()
    if len(token) < 15:
        print("ERRO: token de acesso ausente/incompleto.")
        return 1

    try:
        config = request("GET", token)
        site_url = str(config.get("site_url") or "(não informada)")
        print("\nConsulta à configuração remota: OK")
        print("Site URL atual:", site_url)
        print("SMTP atual:", str(config.get("smtp_host") or "não configurado"))
        if not site_url.startswith(EXPECTED_URL):
            print("\nATENÇÃO: a Site URL não corresponde ao CRM.")
            print("Não aplicaremos templates até verificar a URL de redirecionamento.")
            return 2

        files = {}
        for kind in SUBJECTS:
            p = BASE / "templates" / f"{kind}.html"
            if not p.is_file():
                raise RuntimeError(f"Template ausente: {p.name}")
            html = p.read_text(encoding="utf-8")
            if "{{ .ConfirmationURL }}" not in html:
                raise RuntimeError(f"Template sem link seguro: {p.name}")
            files[kind] = html

        print("\nTemplates encontrados:", ", ".join(SUBJECTS))
        print("O SMTP será do Resend, com remetente nao-responda@crm.fococontrole.com.br.")
        print("Para voltar sem executar nenhuma alteração, pressione Ctrl+C.")
        resend = getpass.getpass("Chave API do Resend (oculta): ").strip()
        if not resend.startswith("re_") or len(resend) < 12:
            print("ERRO: a chave Resend parece inválida; nenhuma alteração foi feita.")
            return 3
        decision = input("\nDigite APLICAR para ativar SMTP e 5 templates: ").strip()
        if decision != "APLICAR":
            print("Cancelado. Nenhuma configuração alterada.")
            return 0

        smtp = {
            "smtp_admin_email": "nao-responda@crm.fococontrole.com.br",
            "smtp_host": "smtp.resend.com",
            "smtp_port": "465",
            "smtp_user": "resend",
            "smtp_pass": resend,
            "smtp_sender_name": "Foco Controle",
            "external_email_enabled": True,
        }
        request("PATCH", token, smtp)
        print("\n1/2 — SMTP configurado.")
        resend = ""  # não exibir nem salvar a credencial

        updates = {}
        for kind, subject in SUBJECTS.items():
            updates[f"mailer_subjects_{kind}"] = subject
            updates[f"mailer_templates_{kind}_content"] = files[kind]
        request("PATCH", token, updates)
        print("2/2 — Modelos HTML enviados.")

        current = request("GET", token)
        ok = (current.get("smtp_host") == "smtp.resend.com" and
              current.get("smtp_admin_email") == "nao-responda@crm.fococontrole.com.br" and
              all(SUBJECTS[kind] == current.get(f"mailer_subjects_{kind}") for kind in SUBJECTS))
        if not ok:
            print("ATENÇÃO: resposta de verificação incompleta. Confira o painel Auth.")
            return 4
        print("\nSUCESSO: SMTP e assuntos dos 5 templates verificados na API do Supabase.")
        print("Próximo teste: solicitar recuperação de senha e verificar o recebimento real.")
        return 0
    except (RuntimeError, KeyboardInterrupt, EOFError) as exc:
        print("\nInterrompido:", str(exc) if str(exc) else "solicitação cancelada")
        return 1


if __name__ == "__main__":
    sys.exit(main())
