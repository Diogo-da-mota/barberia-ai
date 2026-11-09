import { supabase } from "@/lib/supabase"
import { buildMediaPath, type AccentKey, type MediaKind } from "./domain"

export const BUCKET = "site-media"

export type MediaRow = { id: string; kind: MediaKind; storage_path: string; mime: string; tamanho_bytes: number; criado_em: string }

export function publicMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

export async function saveSiteProfile(input: { shopId: string; descricao: string; cor: AccentKey | null; endereco: string; telefone: string; reminderConfig?: ReminderConfig }): Promise<void> {
  const { error } = await supabase.rpc("save_site_profile", {
    p_barbershop_id: input.shopId, p_descricao: input.descricao, p_cor: input.cor, p_endereco: input.endereco, p_telefone: input.telefone,
    p_reminder_config: input.reminderConfig ?? null,
  })
  if (error) throw error
}

export async function setShopSlug(shopId: string, slug: string): Promise<void> {
  const { error } = await supabase.rpc("set_shop_slug", { p_barbershop_id: shopId, p_slug: slug })
  if (error) throw error
}

export type ReminderConfig = {
  auto_confirmation: boolean
  auto_reminder: boolean
  lead_time_minutes: 15 | 30 | 60 | 120
}

export type SiteProfile = {
  descricao: string | null
  cor_destaque: AccentKey | null
  endereco: string | null
  telefone: string | null
  slug: string
  reminder_config: ReminderConfig
  /** `undefined` = o banco ainda não tem a coluna (migration 0011 pendente): o modelo só pode ser visto na prévia, não salvo. */
  template?: string | null
}

const PROFILE_COLUMNS = "descricao, cor_destaque, endereco, telefone, slug, reminder_config"

export async function fetchSiteProfile(shopId: string): Promise<SiteProfile> {
  const withTemplate = await supabase.from("barbershops").select(`${PROFILE_COLUMNS}, template`).eq("id", shopId).single()
  if (!withTemplate.error) return withTemplate.data as unknown as SiteProfile
  // 42703 = coluna inexistente: banco sem a migration 0011/0017. Qualquer outro erro continua sendo erro.
  if (withTemplate.error.code !== "42703") throw withTemplate.error
  const { data, error } = await supabase.from("barbershops").select(PROFILE_COLUMNS).eq("id", shopId).single()
  if (error) throw error
  return data as unknown as SiteProfile
}

export async function saveSiteTemplate(shopId: string, template: string): Promise<void> {
  const { error } = await supabase.rpc("save_site_template", { p_barbershop_id: shopId, p_template: template })
  if (error) throw error
}

export async function fetchMedia(shopId: string): Promise<MediaRow[]> {
  const { data, error } = await supabase
    .from("media_objects").select("id, kind, storage_path, mime, tamanho_bytes, criado_em")
    .eq("barbershop_id", shopId).order("criado_em")
  if (error) throw error
  return data as MediaRow[]
}

/** Envia ao storage dentro da pasta da barbearia e só então registra; se o servidor recusar, apaga o arquivo enviado. */
export async function uploadMedia(shopId: string, kind: MediaKind, file: File): Promise<void> {
  const path = buildMediaPath(shopId, kind, file.type, crypto.randomUUID().slice(0, 8))
  // logo e capa são únicos: ao trocar, o arquivo antigo sai do storage depois que o novo é aceito
  const antigo = kind === "galeria" ? [] : ((await supabase.from("media_objects").select("storage_path").eq("barbershop_id", shopId).eq("kind", kind)).data ?? []).map((m) => m.storage_path as string)
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) throw upload.error
  const { error } = await supabase.rpc("register_media", { p_barbershop_id: shopId, p_kind: kind, p_path: path })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  if (antigo.length > 0) await supabase.storage.from(BUCKET).remove(antigo)
}

export async function removeMedia(id: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_media", { p_id: id })
  if (error) throw error
  if (typeof data === "string") await supabase.storage.from(BUCKET).remove([data])
}
