/**
 * Sincronização de webhook na instância Evolution.
 * Garante que a instância aponta para o webhook correto desta deployment.
 */

import { getWebhookUrl, type EvolutionConfig } from './evolution-config.ts';
import { setInstanceWebhook } from './evolution-client.ts';

/**
 * Configura o webhook na instância (idempotente).
 * Deve ser chamado a cada conexão/reconexão para garantir URL correta.
 */
export async function syncInstanceWebhook(config: EvolutionConfig, instanceName: string): Promise<void> {
  const webhookUrl = getWebhookUrl(config);
  await setInstanceWebhook(config, instanceName, webhookUrl);
}

/**
 * Verifica se o webhook está configurado corretamente.
 * Útil para diagnóstico.
 */
export async function verifyWebhook(config: EvolutionConfig, instanceName: string): Promise<{ configured: boolean; url: string | null }> {
  try {
    // Evolution não tem endpoint GET para webhook config, então só tentamos setar
    // Se falhar, sabemos que há problema
    const webhookUrl = getWebhookUrl(config);
    await setInstanceWebhook(config, instanceName, webhookUrl);
    return { configured: true, url: webhookUrl };
  } catch {
    return { configured: false, url: null };
  }
}