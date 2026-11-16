/**
 * Cifra dos segredos guardados no banco (chave de IA da barbearia): AES-256-GCM da Web Crypto.
 * A barbearia entra como dado associado, então o texto cifrado de uma barbearia não abre em outra.
 * A chave mestra (32 bytes em base64) é o segredo AI_CREDENTIALS_KEY das Edge Functions; nunca vai para o banco.
 */
// snip:prod — limite de segurança: credenciais de terceiros cifradas e isoladas por barbearia.
const text = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function importKey(masterB64: string | undefined): Promise<CryptoKey> {
  const raw = masterB64 ? unb64(masterB64) : new Uint8Array();
  if (raw.length !== 32) throw new Error('AI_CREDENTIALS_KEY ausente ou inválida (32 bytes em base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** "iv.cifra" em base64; um iv novo a cada gravação. */
export async function encryptSecret(plain: string, shopId: string, masterB64: string | undefined): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(shopId) }, await importKey(masterB64), text.encode(plain));
  return `${b64(iv)}.${b64(new Uint8Array(sealed))}`;
}

/** Falha (lança) com chave mestra errada, texto adulterado ou barbearia diferente. */
export async function decryptSecret(sealed: string, shopId: string, masterB64: string | undefined): Promise<string> {
  const [iv, data] = sealed.split('.').map(unb64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: text.encode(shopId) }, await importKey(masterB64), data);
  return new TextDecoder().decode(plain);
}
