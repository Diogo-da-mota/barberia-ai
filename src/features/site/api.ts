import { supabase } from "@/lib/supabase"
import { MEDIA_FOLDERS, type AccentKey, type MediaKind } from "./domain"

/**
 * Fotos no AWS S3 (bucket privado), lidas pelo CloudFront (`VITE_MEDIA_CDN_URL`), na pasta BARBEARIA/<barbearia>/...
 * Quem grava e apaga é a Edge Function `media` (só a gestão da barbearia dona da pasta); o banco guarda o caminho.
 * Cada envio tem nome único: trocar uma foto muda o endereço (o CDN e o navegador nunca mostram a antiga) e a antiga é apagada.
 */
const S3_PREFIX = "BARBEARIA/"
// snip: caminhos antigos do Supabase Storage só até a cópia para o S3 (Edge Function media-migrate); depois, remover este ramo
const LEGACY_BUCKET = "site-media"
const cdn = () => String(import.meta.env.VITE_MEDIA_CDN_URL ?? "").replace(/\/+$/, "")

export type MediaRow = { id: string; kind: MediaKind; storage_path: string; mime: string; tamanho_bytes: number; criado_em: string }

export function publicMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (path.startsWith(S3_PREFIX)) return cdn() ? `${cdn()}/${path}` : null
  return supabase.storage.from(LEGACY_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Erro da função `media` com o código que as telas traduzem (invalid_media, forbidden...). */
async function mediaError(error: unknown): Promise<Error> {
  const response = (error as { context?: Response } | null)?.context
  const body = response && typeof response.json === "function" ? ((await response.json().catch(() => null)) as { error?: string } | null) : null
  return new Error(body?.error ?? "media_failed")
}

/** Envia a foto para a pasta da barbearia no S3 (a função confere papel, tipo pelo conteúdo e tamanho). */
export async function uploadToStorage(shopId: string, folder: string, file: File): Promise<{ key: string; size: number }> {
  const body = new FormData()
  body.append("barbearia", shopId)
  body.append("pasta", folder)
  body.append("arquivo", file)
  const { data, error } = await supabase.functions.invoke<{ key: string; size: number }>("media", { body })
  if (error || !data?.key) throw await mediaError(error)
  return data
}

/** Apaga arquivos que saíram de uso (foto trocada ou removida). Melhor esforço: a foto nova já está valendo. */
export async function removeStoredFiles(paths: (string | null | undefined)[]): Promise<void> {
  const files = paths.filter((p): p is string => Boolean(p))
  const s3 = files.filter((p) => p.startsWith(S3_PREFIX))
  const legacy = files.filter((p) => !p.startsWith(S3_PREFIX))
  if (s3.length) await supabase.functions.invoke("media", { body: { apagar: s3 } })
  if (legacy.length) await supabase.storage.from(LEGACY_BUCKET).remove(legacy)
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

/** Envia para o S3 e só então registra (o banco devolve a foto substituída, que é apagada); se o banco recusar, apaga o envio. */
export async function uploadMedia(shopId: string, kind: MediaKind, file: File): Promise<void> {
  const { key, size } = await uploadToStorage(shopId, MEDIA_FOLDERS[kind], file)
  const { data, error } = await supabase.rpc("register_media", { p_barbershop_id: shopId, p_kind: kind, p_path: key, p_size: size })
  if (error) {
    await removeStoredFiles([key])
    throw error
  }
  await removeStoredFiles([data as string | null])
}

export async function removeMedia(id: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_media", { p_id: id })
  if (error) throw error
  await removeStoredFiles([data as string | null])
}

/** Fotos de Meu site › Fotos (registradas como as demais, uma por posição). Sem foto própria, vale a padrão. */
export const PANEL_PHOTO_KINDS = {
  menu: "painel_sidebar", inicio: "painel_inicio", agenda: "painel_agendamentos", servicos: "painel_servicos", financeiro: "painel_financeiro",
  login: "login_cliente", // porta do cliente (/:slug/entrar); o login da equipe não muda
} as const satisfies Record<string, MediaKind>
export type PanelPhoto = keyof typeof PANEL_PHOTO_KINDS
export type PanelPhotoUrls = Record<PanelPhoto, string | null>

/** Uma consulta para todas (a equipe lê; o cliente não). */
export async function fetchPanelPhotos(shopId: string): Promise<PanelPhotoUrls> {
  const { data, error } = await supabase.from("media_objects").select("kind, storage_path").eq("barbershop_id", shopId).in("kind", Object.values(PANEL_PHOTO_KINDS))
  if (error) throw error
  const byKind = new Map((data ?? []).map((m) => [m.kind as string, m.storage_path as string]))
  return Object.fromEntries(Object.entries(PANEL_PHOTO_KINDS).map(([photo, kind]) => [photo, publicMediaUrl(byKind.get(kind))])) as PanelPhotoUrls
}

export const savePanelPhoto = (shopId: string, photo: PanelPhoto, file: File) => uploadMedia(shopId, PANEL_PHOTO_KINDS[photo], file)

export async function removePanelPhoto(shopId: string, photo: PanelPhoto): Promise<void> {
  const { data, error } = await supabase.from("media_objects").select("id").eq("barbershop_id", shopId).eq("kind", PANEL_PHOTO_KINDS[photo]).maybeSingle()
  if (error) throw error
  if (data) await removeMedia(data.id as string)
}

/** Foto do login do cliente na página da barbearia (o visitante, sem conta, lê pelo endereço); null = foto padrão. */
export async function fetchLoginPhoto(slug: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_shop_login_photo", { p_slug: slug })
  if (error) throw error
  return publicMediaUrl(data as string | null)
}
