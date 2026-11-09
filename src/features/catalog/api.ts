import { supabase } from "@/lib/supabase"
import { fetchPayments } from "@/features/finance/api"
import { SALES_DAYS, type SaleRow } from "./sales"
import { BUCKET } from "@/features/site/api"
import { professionalAvatarPath, servicePhotoPath } from "./domain"
import type { CatalogResult, Professional, ProfessionalInput, Service, ServiceInput } from "./domain"

/** Resposta do PostgREST quando a tabela ainda não existe no banco. */
const TABLE_NOT_FOUND = "PGRST205"

const SERVICE_COLUMNS_SEM_FOTO = "id, nome, descricao, preco_centavos, duracao_min, ativo"
// do mais completo ao mais antigo: a tela continua funcionando se alguma migration ainda não foi aplicada
const SERVICE_SELECTS = [
  `${SERVICE_COLUMNS_SEM_FOTO}, imagem_path, service_photos(id, storage_path, ordem)`,
  `${SERVICE_COLUMNS_SEM_FOTO}, imagem_path`,
  SERVICE_COLUMNS_SEM_FOTO,
]
const SCHEMA_MISSING = new Set(["42703", "PGRST200", "PGRST204", "PGRST205"])

type ServiceRow = Omit<Service, "fotos" | "galeria"> & { service_photos?: { id: string; storage_path: string; ordem: number }[] }

export async function fetchServices(barbershopId: string): Promise<CatalogResult<Service[]>> {
  let rows: unknown = null
  let error: { code?: string; message?: string } | null = null
  for (const columns of SERVICE_SELECTS) {
    const result = await supabase.from("services").select(columns).eq("barbershop_id", barbershopId).order("nome")
    rows = result.data
    error = result.error
    if (!error || !SCHEMA_MISSING.has(error.code ?? "")) break
  }
  if (error) {
    if (error.code === TABLE_NOT_FOUND) return { status: "unavailable" }
    throw error
  }
  const data = (rows as ServiceRow[]).map(({ service_photos, ...rest }) => {
    const galeria = [...(service_photos ?? [])].sort((x, y) => x.ordem - y.ordem).map((f) => ({ id: f.id, path: f.storage_path }))
    return { ...rest, galeria, fotos: galeria.map((f) => f.path) } as Service
  })
  return { status: "ok", data }
}

/** O RLS decide quem escreve: uma escrita bloqueada não dá erro, apenas afeta 0 linhas. */
/** Atendimentos concluídos do período e os pagamentos deles. A gestão lê tudo; o RLS esconde o resto. */
export async function fetchServiceSales(barbershopId: string, days = SALES_DAYS): Promise<{ sales: SaleRow[]; payments: Awaited<ReturnType<typeof fetchPayments>>["payments"]; refunds: Awaited<ReturnType<typeof fetchPayments>>["refunds"] }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("bookings").select("id, service_id, preco_centavos")
    .eq("barbershop_id", barbershopId).eq("status", "concluido").gte("inicio", since).limit(1000)
  if (error) throw error
  const sales = (data ?? []) as SaleRow[]
  const payments: Awaited<ReturnType<typeof fetchPayments>>["payments"] = []
  const refunds: Awaited<ReturnType<typeof fetchPayments>>["refunds"] = []
  for (let i = 0; i < sales.length; i += 100) {
    const part = await fetchPayments(sales.slice(i, i + 100).map((s) => s.id))
    payments.push(...part.payments)
    refunds.push(...part.refunds)
  }
  return { sales, payments, refunds }
}

export async function saveService(barbershopId: string, input: ServiceInput, id?: string): Promise<void> {
  if (id) {
    const { data, error } = await supabase.from("services").update(input).eq("id", id).eq("barbershop_id", barbershopId).select("id")
    if (error) throw error
    if (!data?.length) throw Object.assign(new Error("not_found"), { code: "42501" })
    return
  }
  const { error } = await supabase.from("services").insert({ ...input, barbershop_id: barbershopId })
  if (error) throw error
}

export async function deleteService(barbershopId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from("services").delete().eq("id", id).eq("barbershop_id", barbershopId).select("id")
  if (error) throw error
  if (!data?.length) throw Object.assign(new Error("not_found"), { code: "42501" })
}

type ProfessionalRow = Omit<Professional, "service_ids"> & { professional_services: { service_id: string }[] }

export async function fetchProfessionals(barbershopId: string): Promise<CatalogResult<Professional[]>> {
  const { data, error } = await supabase
    .from("professionals")
    .select("id, nome, ativo, avatar_path, professional_services(service_id)")
    .eq("barbershop_id", barbershopId)
    .order("nome")
  if (error) {
    if (error.code === TABLE_NOT_FOUND) return { status: "unavailable" }
    throw error
  }
  const rows = data as unknown as ProfessionalRow[]
  return {
    status: "ok",
    data: rows.map(({ professional_services, ...rest }) => ({ ...rest, service_ids: professional_services.map((link) => link.service_id) })),
  }
}

/** Criar ou atualizar o profissional e seus serviços acontece em uma única transação no servidor. */
export async function saveProfessional(barbershopId: string, input: ProfessionalInput, id?: string): Promise<string> {
  const { data, error } = await supabase.rpc("save_professional", {
    p_barbershop_id: barbershopId,
    p_id: id ?? null,
    p_nome: input.nome,
    p_ativo: input.ativo,
    p_service_ids: input.serviceIds,
  })
  if (error) throw error
  return data as string
}

export type Barber = { profile_id: string; nome: string; email: string | null }

/** Contas com papel de barbeiro na barbearia (a gestão lê os vínculos e perfis pelo RLS). */
export async function fetchBarbers(barbershopId: string): Promise<Barber[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("profile_id, profiles(nome, email)")
    .eq("barbershop_id", barbershopId)
    .eq("papel", "barbeiro")
  if (error) throw error
  const rows = data as unknown as { profile_id: string; profiles: { nome: string; email: string | null } | null }[]
  return rows.map((row) => ({ profile_id: row.profile_id, nome: row.profiles?.nome ?? "Barbeiro", email: row.profiles?.email ?? null }))
}

/** professional_id → profile_id (somente a gestão recebe dados). */
export async function fetchTeamLinks(barbershopId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc("get_team_links", { p_barbershop_id: barbershopId })
  if (error) throw error
  return Object.fromEntries((data as { professional_id: string; profile_id: string }[]).map((row) => [row.professional_id, row.profile_id]))
}

export async function linkProfessional(professionalId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase.rpc("link_professional", { p_professional_id: professionalId, p_profile_id: profileId })
  if (error) throw error
}

export async function deleteProfessional(barbershopId: string, id: string): Promise<void> {
  const { data, error } = await supabase.from("professionals").delete().eq("id", id).eq("barbershop_id", barbershopId).select("id")
  if (error) throw error
  if (!data?.length) throw Object.assign(new Error("not_found"), { code: "42501" })
}

/**
 * Envia a foto do serviço ao bucket de mídia da própria barbearia e só então a vincula (set_service_image).
 * Se o banco recusar, o arquivo enviado é apagado. A foto anterior é apagada depois que a nova foi aceita.
 */
export async function uploadServiceImage(shopId: string, serviceId: string, file: File): Promise<void> {
  const path = servicePhotoPath(shopId, serviceId, file.type, crypto.randomUUID().slice(0, 8))
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) throw upload.error
  const { data, error } = await supabase.rpc("set_service_image", { p_service_id: serviceId, p_path: path })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  if (typeof data === "string" && data) await supabase.storage.from(BUCKET).remove([data])
}

export async function removeServiceImage(serviceId: string): Promise<void> {
  const { data, error } = await supabase.rpc("set_service_image", { p_service_id: serviceId, p_path: null })
  if (error) throw error
  if (typeof data === "string" && data) await supabase.storage.from(BUCKET).remove([data])
}

/** Galeria do serviço (até 5): envia ao bucket da barbearia e só então registra; se o banco recusar (ex.: 6ª foto), apaga o arquivo. */
export async function addServicePhoto(shopId: string, serviceId: string, file: File): Promise<void> {
  const path = servicePhotoPath(shopId, serviceId, file.type, crypto.randomUUID().slice(0, 8))
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) throw upload.error
  const { error } = await supabase.rpc("add_service_photo", { p_service_id: serviceId, p_path: path })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

export async function removeServicePhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase.rpc("remove_service_photo", { p_id: photoId })
  if (error) throw error
  if (typeof data === "string" && data) await supabase.storage.from(BUCKET).remove([data])
}

/** Foto de perfil do profissional (estrutura: Supabase Storage por enquanto, sem AWS). */
export async function uploadProfessionalAvatar(shopId: string, professionalId: string, file: File): Promise<void> {
  const path = professionalAvatarPath(shopId, professionalId, file.type, crypto.randomUUID().slice(0, 8))
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) throw upload.error
  const { data, error } = await supabase.rpc("set_professional_avatar", { p_professional_id: professionalId, p_path: path })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  if (typeof data === "string" && data) await supabase.storage.from(BUCKET).remove([data])
}

export async function removeProfessionalAvatar(professionalId: string): Promise<void> {
  const { data, error } = await supabase.rpc("set_professional_avatar", { p_professional_id: professionalId, p_path: null })
  if (error) throw error
  if (typeof data === "string" && data) await supabase.storage.from(BUCKET).remove([data])
}

export type ProfessionalContact = { telefone: string | null; email: string | null; documento: string | null }

/** Telefone, e-mail e CPF/CNPJ: só a gestão lê (função get_professional_contacts); a API não libera essas colunas. */
export async function fetchProfessionalContacts(shopId: string): Promise<Record<string, ProfessionalContact>> {
  const { data, error } = await supabase.rpc("get_professional_contacts", { p_barbershop_id: shopId })
  if (error) throw error
  return Object.fromEntries(((data ?? []) as (ProfessionalContact & { professional_id: string })[]).map(({ professional_id, ...contact }) => [professional_id, contact]))
}

export async function saveProfessionalContact(professionalId: string, contact: ProfessionalContact): Promise<void> {
  const { error } = await supabase.rpc("save_professional_contact", {
    p_professional_id: professionalId, p_telefone: contact.telefone ?? "", p_email: contact.email ?? "", p_documento: contact.documento ?? "",
  })
  if (error) throw error
}
