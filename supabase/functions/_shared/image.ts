/**
 * Regras puras das fotos no S3 (sem Deno, testáveis): tipo pelo conteúdo, pastas permitidas e caminho.
 * O banco confere a mesma estrutura ao registrar (migration 0023, private.s3_media_key).
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export const UUID_RE = new RegExp(`^${UUID}$`)

/** Pastas dentro de BARBEARIA/<barbearia>/. */
export const MEDIA_FOLDER_RE = new RegExp(
  `^(site/(logo|capa|galeria)|painel/(inicio|agendamentos|servicos|sidebar|financeiro)|login|servicos/${UUID}|profissionais/${UUID})$`,
)

/** Pasta de cada tipo de foto registrada em media_objects. */
export const KIND_FOLDER: Record<string, string> = {
  logo: 'site/logo', capa: 'site/capa', galeria: 'site/galeria',
  painel_inicio: 'painel/inicio', painel_agendamentos: 'painel/agendamentos', painel_servicos: 'painel/servicos',
  painel_sidebar: 'painel/sidebar', painel_financeiro: 'painel/financeiro', login_cliente: 'login',
}

/** Arquivos fixos que o painel gravava no Supabase Storage antes do S3 (sem registro no banco). */
export const LEGACY_PANEL_FILES: Record<string, string> = {
  'painel-menu.jpg': 'painel_sidebar', 'painel-inicio.jpg': 'painel_inicio', 'painel-agenda.jpg': 'painel_agendamentos',
  'painel-servicos.jpg': 'painel_servicos', 'painel-financeiro.jpg': 'painel_financeiro', 'painel-login-cliente.jpg': 'login_cliente',
}

/** Barbearia dona de um caminho do S3 (null se o caminho não é de foto de barbearia). */
export function keyShop(key: string): string | null {
  const m = new RegExp(`^BARBEARIA/(${UUID})/[a-z0-9/-]+\\.(jpg|png|webp)$`).exec(key)
  return m && !key.includes('//') ? m[1] : null
}

/** Caminho novo: nome único por envio (o CDN e o navegador nunca mostram a foto antiga). */
export const newKey = (shopId: string, folder: string, ext: string) => `BARBEARIA/${shopId}/${folder}/${crypto.randomUUID()}.${ext}`

/** Tipo pelo conteúdo (não pelo que o navegador diz): JPEG, PNG ou WebP. */
export function imageType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return { mime: 'image/png', ext: 'png' }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}
