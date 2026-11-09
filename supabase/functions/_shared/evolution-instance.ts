/**
 * Lifecycle da instância Evolution por barbearia.
 * Inclui geração do nome da instância (server-side, imutável).
 */

import type { EvolutionQr } from './evolution-client.ts';
import type { EvolutionConfig } from './evolution-config.ts';
import { instanceExists, createInstance, connectInstance, fetchInstance, logoutInstance, deleteInstance, setInstanceWebhook } from './evolution-client.ts';
import { getWebhookUrl } from './evolution-config.ts';

/**
 * Gera nome da instância Evolution a partir do nome da barbearia + UUID.
 * Formato: barberia_<nome_normalizado>_<uuid_12chars>
 * Server-side only — nunca exposto ao frontend.
 *
 * Exemplo: "Barbearia do TICO" + "a1b2c3d4e5f6..." → "barberia_barbearia_do_tico_a1b2c3d4e5f6"
 */
export function instanceNameForBarbershop(nome: string, barbershopId: string): string {
  // Normaliza: remove acentos, minúsculas, não-alfanuméricos → _
  const slug = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

  // 12 primeiros chars do UUID (sem hífens) para unicidade
  const shortId = barbershopId.replace(/-/g, '').slice(0, 12);

  return `barberia_${slug}_${shortId}`;
}

/**
 * Garante que a instância existe, configura webhook e retorna QR ou estado conectado.
 * Usado pela Edge Function POST /connect.
 */
export async function ensureInstanceAndGetQr(
  config: EvolutionConfig,
  barbershopId: string,
  nome: string,
  existingInstanceName: string | null
): Promise<{ instanceName: string; qr: EvolutionQr; connected: boolean; state: string; number: string | null; profileName: string | null }> {
  const instanceName = existingInstanceName || instanceNameForBarbershop(nome, barbershopId);

  // Cria instância se não existir
  if (!(await instanceExists(config, instanceName))) {
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    await createInstance(config, instanceName, token);
  }

  // Configura webhook (idempotente)
  const webhookUrl = getWebhookUrl(config);
  await setInstanceWebhook(config, instanceName, webhookUrl);

  // Busca estado atual
  const live = await fetchInstance(config, instanceName);
  if (!live) throw new Error('Evolution API inacessível');

  if (live.state === 'open') {
    return { instanceName, qr: { base64: null, pairingCode: null }, connected: true, state: live.state, number: live.number, profileName: live.profileName };
  }

  // Gera QR code novo
  const qr = await connectInstance(config, instanceName);
  const state = live.state === 'not_found' ? 'connecting' : live.state;

  return { instanceName, qr, connected: false, state, number: live.number, profileName: live.profileName };
}

/**
 * Busca estado vivo da instância (para polling GET /status).
 */
export async function getInstanceStatus(
  config: EvolutionConfig,
  instanceName: string
): Promise<{ connected: boolean; state: string; number: string | null; profileName: string | null } | null> {
  const live = await fetchInstance(config, instanceName);
  if (!live) return null;
  return {
    connected: live.state === 'open',
    state: live.state,
    number: live.number,
    profileName: live.profileName,
  };
}

/**
 * Desconecta e deleta a instância completamente.
 * Usado pela Edge Function DELETE /connect.
 */
export async function disconnectAndDeleteInstance(
  config: EvolutionConfig,
  instanceName: string
): Promise<void> {
  try {
    await logoutInstance(config, instanceName);
  } catch (err) {
    console.warn('[evolution] logout falhou (continuando):', err instanceof Error ? err.message : err);
  }
  await deleteInstance(config, instanceName);
}