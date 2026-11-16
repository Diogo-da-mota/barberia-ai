/**
 * Chave de IA da barbearia (OpenAI ou Anthropic) para a Assistente. Só o proprietário ou o gerente da barbearia.
 *   POST { barbearia }                     → { conexao: { provedor, final, atualizado_em } | null }
 *   POST { barbearia, provedor, chave }    → confere a chave no provedor, cifra, grava (troca a anterior) → { conexao }
 *   POST { barbearia, remover: true }      → apaga → { conexao: null }
 * A chave nunca volta ao navegador nem vai para o log: fica cifrada em ai_credentials (migration 0024, sem acesso do navegador).
 * Assinatura do ChatGPT (Sign in with ChatGPT) não entra: a OpenAI só libera para apps aprovados (OPERACAO.md).
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { AuthError, requireBarbershopManagement } from '../_shared/auth.ts';
import { UUID_RE } from '../_shared/image.ts';
import { encryptSecret } from '../_shared/secret.ts';

type Provider = 'openai' | 'anthropic';
const PROVIDERS: readonly string[] = ['openai', 'anthropic'];
const KEY_RE = /^[\x21-\x7e]{20,300}$/; // caracteres visíveis, sem espaço: nada além da chave chega ao cabeçalho do provedor
const TIMEOUT_MS = 15_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** true = o provedor aceitou; false = recusou a chave (401/403); lança se o provedor não respondeu. */
async function keyWorks(provider: Provider, key: string): Promise<boolean> {
  if (provider === 'anthropic') {
    try {
      await new Anthropic({ apiKey: key, maxRetries: 0, timeout: TIMEOUT_MS }).models.list({ limit: 1 });
      return true;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return false;
      throw err;
    }
  }
  const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  await res.body?.cancel();
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw new Error(`openai_${res.status}`);
  return true;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const body = (await req.json().catch(() => null)) as { barbearia?: unknown; provedor?: unknown; chave?: unknown; remover?: unknown } | null;
    const shopId = String(body?.barbearia ?? '');
    if (!UUID_RE.test(shopId)) return json({ error: 'invalid_request' }, 400);
    const { supabase } = await requireBarbershopManagement(req, shopId);

    if (body?.remover === true) {
      const { error } = await supabase.from('ai_credentials').delete().eq('barbershop_id', shopId);
      if (error) throw error;
      return json({ conexao: null });
    }

    if (body?.chave !== undefined) {
      const provider = String(body.provedor ?? '');
      const key = String(body.chave).trim();
      if (!PROVIDERS.includes(provider) || !KEY_RE.test(key)) return json({ error: 'invalid_key' }, 400);
      const master = Deno.env.get('AI_CREDENTIALS_KEY');
      if (!master) return json({ error: 'not_configured' }, 503);
      let works: boolean;
      try {
        works = await keyWorks(provider as Provider, key);
      } catch {
        return json({ error: 'provider_unavailable' }, 502); // sem detalhe: a resposta do provedor não interessa à tela
      }
      if (!works) return json({ error: 'key_rejected' }, 400);
      const conexao = { provedor: provider, final: key.slice(-4), atualizado_em: new Date().toISOString() };
      const { error } = await supabase.from('ai_credentials').upsert({ barbershop_id: shopId, ...conexao, chave_cifrada: await encryptSecret(key, shopId, master) });
      if (error) throw error;
      return json({ conexao });
    }

    const { data, error } = await supabase.from('ai_credentials').select('provedor, final, atualizado_em').eq('barbershop_id', shopId).maybeSingle();
    if (error) throw error;
    return json({ conexao: data });
  } catch (err) {
    if (err instanceof AuthError) return json({ error: 'forbidden' }, err.status);
    console.error('[ai-credentials]', err instanceof Error ? err.message : 'erro');
    return json({ error: 'ai_credentials_failed' }, 500);
  }
});
