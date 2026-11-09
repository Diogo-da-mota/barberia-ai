import { supabase } from "@/lib/supabase"
import { parseViaCep, type CepAddress, type DocumentType, type TipoPessoa } from "./domain"

const COLUMN_MISSING = new Set(["42703", "PGRST204"])
const TABLE_MISSING = new Set(["42P01", "PGRST205", "PGRST200"])
const isColumnMissing = (e: { code?: string } | null) => Boolean(e?.code && COLUMN_MISSING.has(e.code))
const isTableMissing = (e: { code?: string } | null) => Boolean(e?.code && (TABLE_MISSING.has(e.code) || COLUMN_MISSING.has(e.code)))

/** Dados da barbearia numa leitura só. `supported = false` quando o banco ainda não tem as colunas da migration 0012. */
export type ShopDetails = {
  supported: boolean
  nome: string; nome_exibicao: string | null; descricao: string | null; telefone: string | null; whatsapp: string | null; email_comercial: string | null
  endereco: string | null; cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null
  cor_destaque: string | null; fuso: string | null
}

const BASE = "nome, descricao, telefone, endereco, cor_destaque, fuso"
const EXTRA = "nome_exibicao, whatsapp, email_comercial, cep, logradouro, numero, complemento, bairro, cidade, uf"

export async function fetchShopDetails(shopId: string): Promise<ShopDetails> {
  const full = await supabase.from("barbershops").select(`${BASE}, ${EXTRA}`).eq("id", shopId).single()
  if (!full.error) return { supported: true, ...(full.data as object) } as ShopDetails
  if (!isColumnMissing(full.error)) throw full.error
  const { data, error } = await supabase.from("barbershops").select(BASE).eq("id", shopId).single()
  if (error) throw error
  const empty = { nome_exibicao: null, whatsapp: null, email_comercial: null, cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null }
  return { supported: false, ...empty, ...(data as object) } as ShopDetails
}

export type ProfileInput = {
  shopId: string; nome: string; nomeExibicao: string; descricao: string; telefone: string; whatsapp: string; email: string
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string
}
export async function saveShopProfile(i: ProfileInput): Promise<void> {
  const { error } = await supabase.rpc("save_shop_profile", {
    p_barbershop_id: i.shopId, p_nome: i.nome, p_nome_exibicao: i.nomeExibicao, p_descricao: i.descricao, p_telefone: i.telefone, p_whatsapp: i.whatsapp, p_email: i.email,
    p_cep: i.cep, p_logradouro: i.logradouro, p_numero: i.numero, p_complemento: i.complemento, p_bairro: i.bairro, p_cidade: i.cidade, p_uf: i.uf,
  })
  if (error) throw error
}

/** Dados fiscais (só o proprietário lê). `supported = false` sem a tabela da migration 0012; `data = null` quando ainda não há cadastro. */
export type Fiscal = { tipo_pessoa: TipoPessoa; documento: string | null; razao_social: string | null; responsavel_nome: string | null; inscricao_estadual: string | null }
export async function fetchFiscal(shopId: string): Promise<{ supported: boolean; data: Fiscal | null }> {
  const { data, error } = await supabase.from("barbershop_fiscal").select("tipo_pessoa, documento, razao_social, responsavel_nome, inscricao_estadual").eq("barbershop_id", shopId).maybeSingle()
  if (error) {
    if (isTableMissing(error)) return { supported: false, data: null }
    throw error
  }
  return { supported: true, data: (data as Fiscal | null) ?? null }
}

export async function saveShopFiscal(i: { shopId: string; tipo: TipoPessoa; documento: string; razaoSocial: string; responsavel: string; inscricaoEstadual: string }): Promise<void> {
  const { error } = await supabase.rpc("save_shop_fiscal", {
    p_barbershop_id: i.shopId, p_tipo: i.tipo, p_documento: i.documento, p_razao_social: i.razaoSocial, p_responsavel: i.responsavel, p_ie: i.inscricaoEstadual,
  })
  if (error) throw error
}

/** Busca de CEP no ViaCEP (serviço público dos Correios, só recebe o CEP). Qualquer falha devolve null: o usuário preenche à mão. */
export async function lookupCep(cep: string): Promise<CepAddress | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal })
    if (!response.ok) return null
    return parseViaCep(await response.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ---------- Documentos (bucket privado `shop-documents`, migration 0013) ----------

export const DOCUMENTS_BUCKET = "shop-documents"
export type DocumentRow = { id: string; tipo: DocumentType; nome_arquivo: string; storage_path: string; mime: string; tamanho_bytes: number; criado_em: string }

export async function fetchDocuments(shopId: string): Promise<{ supported: boolean; rows: DocumentRow[] }> {
  const { data, error } = await supabase.from("shop_documents").select("id, tipo, nome_arquivo, storage_path, mime, tamanho_bytes, criado_em").eq("barbershop_id", shopId).order("criado_em")
  if (error) {
    if (isTableMissing(error)) return { supported: false, rows: [] }
    throw error
  }
  return { supported: true, rows: data as DocumentRow[] }
}

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" }

/** Envia ao armazenamento privado e só então registra; se o servidor recusar, apaga o arquivo enviado. Reenviar o mesmo tipo substitui o anterior. */
export async function uploadDocument(shopId: string, tipo: DocumentType, file: File): Promise<void> {
  const path = `${shopId}/${tipo}-${crypto.randomUUID().slice(0, 8)}.${EXT[file.type] ?? "bin"}`
  const upload = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) throw upload.error
  const { data, error } = await supabase.rpc("register_shop_document", { p_barbershop_id: shopId, p_tipo: tipo, p_path: path, p_nome: file.name.slice(0, 120) })
  if (error) {
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
    throw error
  }
  const old = (data as { old_path?: string | null } | null)?.old_path
  if (old) await supabase.storage.from(DOCUMENTS_BUCKET).remove([old])
}

export async function removeDocument(id: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_shop_document", { p_id: id })
  if (error) throw error
  if (typeof data === "string") await supabase.storage.from(DOCUMENTS_BUCKET).remove([data])
}

/** Link assinado de 60 segundos, criado só no clique. Nunca existe URL pública de documento. */
export async function signedDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) throw error ?? new Error("signed_url")
  return data.signedUrl
}
