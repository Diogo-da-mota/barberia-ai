/**
 * Cliente Evolution API (adaptado do WACRM).
 * Lógica pura — sem dependência de framework, usa fetch nativo.
 */

import { getEvolutionHeaders, type EvolutionConfig } from './evolution-config.ts';

export interface EvolutionResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface EvolutionInstanceState {
  state: string;
  number: string | null;
  profileName: string | null;
}

export interface EvolutionQr {
  base64: string | null;
  pairingCode: string | null;
}

export const EVOLUTION_WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'CHATS_DELETE',
] as const;

export const EVOLUTION_SECRET_HEADER = 'x-webhook-secret';

export class EvolutionApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'EvolutionApiError';
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 20000;

async function evolutionRequest(
  config: EvolutionConfig,
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; timeoutMs?: number }
): Promise<EvolutionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.url}${path}`, {
      method: init.method,
      headers: getEvolutionHeaders(config),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new EvolutionApiError('Timeout na Evolution API', 504);
    }
    throw new EvolutionApiError(`Falha de rede: ${err instanceof Error ? err.message : 'desconhecido'}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

function errorDetail(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 300);
  const b = body as { response?: { message?: unknown }; message?: unknown; error?: unknown } | null;
  const message = b?.response?.message ?? b?.message ?? b?.error;
  if (message) return (Array.isArray(message) ? message.flat().join('; ') : String(message)).slice(0, 300);
  return JSON.stringify(body ?? '').slice(0, 300);
}

async function call(
  config: EvolutionConfig,
  path: string,
  init: Parameters<typeof evolutionRequest>[2]
): Promise<unknown> {
  const res = await evolutionRequest(config, path, init);
  if (!res.ok) throw new EvolutionApiError(`Evolution HTTP ${res.status}: ${errorDetail(res.body)}`, res.status);
  return res.body;
}

const enc = encodeURIComponent;

/** A Evolution v2 devolve o QR já como data URL; versões antigas, só o base64. A tela recebe sempre a data URL. */
export function toQrDataUrl(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
}

export function toEvolutionNumber(target: string): string {
  const value = String(target ?? '').trim();
  return value.includes('@') ? value : value.replace(/\D/g, '');
}

/** Verifica se a instância existe no servidor Evolution. */
export async function instanceExists(config: EvolutionConfig, name: string): Promise<boolean> {
  const res = await evolutionRequest(config, `/instance/connectionState/${enc(name)}`, { method: 'GET', timeoutMs: 10000 });
  if (res.status === 404) return false;
  if (!res.ok) throw new EvolutionApiError(`Evolution HTTP ${res.status}: ${errorDetail(res.body)}`, res.status);
  return true;
}

/** Cria uma nova instância no Evolution. */
export async function createInstance(config: EvolutionConfig, name: string, token: string): Promise<void> {
  await call(config, '/instance/create', {
    method: 'POST',
    body: { instanceName: name, token, qrcode: false, integration: 'WHATSAPP-BAILEYS' },
  });
}

/** Solicita QR Code para conexão. Só faz sentido enquanto estado não é 'open'. */
export async function connectInstance(config: EvolutionConfig, name: string): Promise<EvolutionQr> {
  const body = await call(config, `/instance/connect/${enc(name)}`, { method: 'GET' }) as {
    base64?: string; pairingCode?: string; qrcode?: { base64?: string; pairingCode?: string };
  } | null;
  const base64 = body?.base64 ?? body?.qrcode?.base64 ?? null;
  return {
    base64: typeof base64 === 'string' && base64 ? toQrDataUrl(base64) : null,
    pairingCode: body?.pairingCode ?? body?.qrcode?.pairingCode ?? null,
  };
}

/** Busca estado atual da instância (estado, número pareado, nome do perfil). */
export async function fetchInstance(config: EvolutionConfig, name: string): Promise<EvolutionInstanceState | null> {
  try {
    const res = await evolutionRequest(config, `/instance/fetchInstances?instanceName=${enc(name)}`, {
      method: 'GET',
      timeoutMs: 10000,
    });
    if (res.status === 404 || res.status === 401) return { state: 'not_found', number: null, profileName: null };
    if (!res.ok || !Array.isArray(res.body)) return null;
    const item = res.body.find((i: { name?: string }) => i?.name === name);
    if (!item) return { state: 'not_found', number: null, profileName: null };
    const number = String(item.ownerJid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
    return {
      state: String(item.connectionStatus ?? 'close'),
      number: number || null,
      profileName: item.profileName || null,
    };
  } catch (err) {
    console.error('[evolution] fetchInstance failed:', name, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Desconecta (logout) a instância — remove pareamento mas mantém a instância. */
export async function logoutInstance(config: EvolutionConfig, name: string): Promise<void> {
  const res = await evolutionRequest(config, `/instance/logout/${enc(name)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 400 && res.status !== 404) {
    throw new EvolutionApiError(`Evolution HTTP ${res.status}: ${errorDetail(res.body)}`, res.status);
  }
}

/** Deleta a instância completamente do servidor Evolution. */
export async function deleteInstance(config: EvolutionConfig, name: string): Promise<void> {
  const res = await evolutionRequest(config, `/instance/delete/${enc(name)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new EvolutionApiError(`Evolution HTTP ${res.status}: ${errorDetail(res.body)}`, res.status);
  }
}

/** Configura webhook na instância (idempotente). */
export async function setInstanceWebhook(
  config: EvolutionConfig,
  name: string,
  webhookUrl: string
): Promise<void> {
  await call(config, `/webhook/set/${enc(name)}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: { [EVOLUTION_SECRET_HEADER]: config.webhookSecret },
        byEvents: false,
        base64: false,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      },
    },
  });
}

/** Envia mensagem de texto. */
export async function evoSendText(
  config: EvolutionConfig,
  name: string,
  args: { number: string; text: string; quotedId?: string }
): Promise<{ messageId: string }> {
  const body = await call(config, `/message/sendText/${enc(name)}`, {
    method: 'POST',
    body: { number: toEvolutionNumber(args.number), text: args.text, ...(args.quotedId ? { quoted: { key: { id: args.quotedId } } } : {}) },
  });
  const id = (body as { key?: { id?: string } } | null)?.key?.id;
  if (!id) throw new EvolutionApiError('Evolution não retornou message id', 502);
  return { messageId: String(id) };
}

/** Envia mídia (imagem, vídeo, documento). */
export async function evoSendMedia(
  config: EvolutionConfig,
  name: string,
  args: { number: string; kind: 'image' | 'video' | 'document'; link: string; mimetype?: string; caption?: string; fileName?: string; quotedId?: string }
): Promise<{ messageId: string }> {
  const body = await call(config, `/message/sendMedia/${enc(name)}`, {
    method: 'POST',
    timeoutMs: 120000,
    body: {
      number: toEvolutionNumber(args.number),
      mediatype: args.kind,
      media: args.link,
      ...(args.mimetype ? { mimetype: args.mimetype } : {}),
      ...(args.caption ? { caption: args.caption } : {}),
      ...(args.fileName ? { fileName: args.fileName } : {}),
      ...(args.quotedId ? { quoted: { key: { id: args.quotedId } } } : {}),
    },
  });
  const id = (body as { key?: { id?: string } } | null)?.key?.id;
  if (!id) throw new EvolutionApiError('Evolution não retornou message id', 502);
  return { messageId: String(id) };
}

/** Envia áudio (PTT). */
export async function evoSendAudio(
  config: EvolutionConfig,
  name: string,
  args: { number: string; link: string; quotedId?: string }
): Promise<{ messageId: string }> {
  const body = await call(config, `/message/sendWhatsAppAudio/${enc(name)}`, {
    method: 'POST',
    timeoutMs: 120000,
    body: { number: toEvolutionNumber(args.number), audio: args.link, ...(args.quotedId ? { quoted: { key: { id: args.quotedId } } } : {}) },
  });
  const id = (body as { key?: { id?: string } } | null)?.key?.id;
  return { messageId: String(id ?? '') };
}

/** Marca mensagem como lida. */
export async function evoMarkRead(
  config: EvolutionConfig,
  name: string,
  args: { remoteJid: string; id: string }
): Promise<void> {
  await call(config, `/chat/markMessageAsRead/${enc(name)}`, {
    method: 'POST',
    body: { readMessages: [{ remoteJid: args.remoteJid, fromMe: false, id: args.id }] },
  });
}