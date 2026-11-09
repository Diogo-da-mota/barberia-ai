import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MessageTemplateEditor } from "./MessageTemplateEditor"
import { DEFAULT_TEMPLATES } from "../../../../supabase/functions/_shared/messages"

const exemplo = { nome: "João", cliente: "João Silva", servico: "Corte + Barba", profissional: "Carlos Barbosa", data: "09/11", dia_semana: "segunda-feira", hora: "08:30", barbearia: "Babearia do TICO", endereco: "", antecedencia: "1 hora", falta: "Falta 1 hora" }

function editor(props: Partial<Parameters<typeof MessageTemplateEditor>[0]> = {}) {
  const onSalvar = vi.fn()
  render(
    <MessageTemplateEditor tipo="lembrete" titulo="Lembrete" icon={null} salvo={DEFAULT_TEMPLATES.lembrete} exemplo={exemplo} podeSalvar salvando={false} onSalvar={onSalvar} {...props} />,
  )
  return { onSalvar, campo: screen.getByLabelText("Texto da mensagem") as HTMLTextAreaElement }
}

describe("editor do texto da mensagem", () => {
  it("abre com o texto padrão com ícones e mostra a prévia montada", () => {
    const { campo } = editor()
    expect(campo).toHaveValue(DEFAULT_TEMPLATES.lembrete)
    expect(screen.getByTestId("previa-lembrete").textContent).toBe(
      "⏰ Olá, João! Falta 1 hora para o seu atendimento!\n\n✂️ Serviço: Corte + Barba\n👤 Profissional: Carlos Barbosa\n📅 Data: 09/11\n🕔 Horário: 08:30\n📍 Local: Babearia do TICO")
    expect(screen.getByRole("button", { name: /Salvar texto/ })).toBeDisabled() // nada mudou
  })

  it("escrever o próprio texto e inserir variável no cursor atualiza a prévia e permite salvar", () => {
    const { campo, onSalvar } = editor()
    fireEvent.change(campo, { target: { value: "Oi , seu horário é às !" } })
    campo.setSelectionRange(3, 3)
    fireEvent.click(screen.getByRole("button", { name: "{nome}" }))
    campo.setSelectionRange(campo.value.indexOf("!"), campo.value.indexOf("!"))
    fireEvent.click(screen.getByRole("button", { name: "{hora}" }))
    expect(campo).toHaveValue("Oi {nome}, seu horário é às {hora}!")
    expect(screen.getByTestId("previa-lembrete")).toHaveTextContent("Oi João, seu horário é às 08:30!")
    fireEvent.click(screen.getByRole("button", { name: /Salvar texto/ }))
    expect(onSalvar).toHaveBeenCalledWith("Oi {nome}, seu horário é às {hora}!")
  })

  it("Texto padrão restaura a pré-mensagem; a confirmação não oferece {antecedencia} nem {falta}", () => {
    const { campo } = editor({ tipo: "confirmacao", salvo: "Texto meu", titulo: "Confirmação" })
    expect(screen.queryByRole("button", { name: "{antecedencia}" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "{falta}" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Texto padrão/ }))
    expect(campo).toHaveValue(DEFAULT_TEMPLATES.confirmacao)
  })

  it("retorno oferece {periodo} e não oferece {hora} nem {falta}", () => {
    editor({ tipo: "retorno", salvo: DEFAULT_TEMPLATES.retorno, titulo: "Retorno", exemplo: { ...exemplo, periodo: "3 meses" } })
    expect(screen.getByRole("button", { name: "{periodo}" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "{hora}" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "{falta}" })).not.toBeInTheDocument()
    expect(screen.getByTestId("previa-retorno")).toHaveTextContent("Já faz 3 meses.")
  })

  it("sem a migration 0019, fica só leitura com o aviso", () => {
    editor({ podeSalvar: false })
    expect(screen.getByLabelText("Texto da mensagem")).toBeDisabled()
    expect(screen.getByText(/exige a migration 0019/)).toBeInTheDocument()
  })
})
