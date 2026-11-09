/**
 * Configuração e validação da Evolution API.
 * Lê secrets do Supabase (Edge Functions) — nunca do frontend.
 */

export interface EvolutionConfig {
  url: string;
  apiKey: string;
  webhookSecret: string;
  webhookBaseUrl: string;
}

/**
 * Carrega e valida configuração da Evolution API.
 * Secrets esperados no Supabase Dashboard > Edge Functions > Secrets:
 * - EVOLUTION_API_URL
 * - EVOLUTION_API_KEY
 * - EVOLUTION_WEBHOOK_SECRET
 * - EVOLUTION_WEBHOOK_BASE_URL
 */
export function loadEvolutionConfig(): EvolutionConfig {
  const url = Deno.env.get('EVOLUTION_API_URL')?.trim().replace(/\/+$/, '');
  const apiKey = Deno.env.get('EVOLUTION_API_KEY')?.trim();
  const webhookSecret = Deno.env.get('EVOLUTION_WEBHOOK_SECRET')?.trim();
  const webhookBaseUrl = Deno.env.get('EVOLUTION_WEBHOOK_BASE_URL')?.trim().replace(/\/+$/, '');

  const missing: string[] = [];
  if (!url) missing.push('EVOLUTION_API_URL');
  if (!apiKey) missing.push('EVOLUTION_API_KEY');
  if (!webhookSecret) missing.push('EVOLUTION_WEBHOOK_SECRET');
  if (!webhookBaseUrl) missing.push('EVOLUTION_WEBHOOK_BASE_URL');

  if (!url || !apiKey || !webhookSecret || !webhookBaseUrl) {
    // O detalhe fica só no log do servidor; as respostas HTTP devolvem mensagem genérica.
    console.error(`[evolution-config] Secrets ausentes: ${missing.join(', ')}`);
    throw new ConfigError(`Evolution API não configurada: ${missing.join(', ')}. Configure os secrets no Supabase Dashboard.`);
  }

  return { url, apiKey, webhookSecret, webhookBaseUrl };
}

/**
 * URL completa do webhook para esta instância.
 * Ex: https://seudominio.com/functions/v1/evolution-webhook
 */
export function getWebhookUrl(config: EvolutionConfig): string {
  return `${config.webhookBaseUrl}/functions/v1/evolution-webhook`;
}

/**
 * Headers padrão para chamadas à Evolution API.
 */
export function getEvolutionHeaders(config: EvolutionConfig): Record<string, string> {
  return {
    'apikey': config.apiKey,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}