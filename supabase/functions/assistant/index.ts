/**
 * Assistente do painel (Configurações › Assistente). Só o proprietário ou o gerente da barbearia.
 *   POST { barbearia, mensagens: [{ role: 'user' | 'assistant', content }] } → { resposta }
 * 1. A sessão é conferida (requireBarbershopManagement) antes de tudo: a barbearia é a da pessoa logada, nunca a que a IA disser.
 * 2. Usa a chave de IA salva da barbearia (ai_credentials, cifrada, migration 0024); sem chave → 409 no_key.
 * 3. As ferramentas (só leitura, _shared/assistant.ts) rodam com o token de quem pediu: RLS e checagens do banco valem.
 * Erros do provedor → 502 { error: key_rejected | rate_limited | provider_error }.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { AuthError, requireBarbershopManagement } from '../_shared/auth.ts';
import { UUID_RE } from '../_shared/image.ts';
import { decryptSecret } from '../_shared/secret.ts';
import { LIMIT_REPLY, MAX_ROUNDS, ProviderError, TOOLS, askOpenAI, loadShop, runTool, systemPrompt, validHistory, type ChatMessage, type RunTool } from '../_shared/assistant.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Laço de ferramentas da Anthropic (Messages API, SDK oficial). Recusas de segurança caem no modelo reserva (fallbacks). */
async function askAnthropic(key: string, system: string, history: ChatMessage[], run: RunTool): Promise<string> {
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 45_000 });
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map(({ role, content }) => ({ role, content }));
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        system,
        tools: tools as Anthropic.Beta.BetaTool[],
        messages,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (response.stop_reason === 'refusal') return 'Não posso ajudar com esse pedido.';
      if (response.stop_reason !== 'tool_use' && response.stop_reason !== 'pause_turn') {
        return response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
      }
      messages.push({ role: 'assistant', content: response.content }); // conteúdo inteiro, sem editar (raciocínio incluso)
      if (response.stop_reason === 'pause_turn') continue;
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      const results = await Promise.all(uses.map(async (u) => ({ type: 'tool_result' as const, tool_use_id: u.id, content: await run(u.name, u.input) })));
      messages.push({ role: 'user', content: results });
    }
    return LIMIT_REPLY;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new ProviderError('key_rejected');
    if (err instanceof Anthropic.RateLimitError) throw new ProviderError('rate_limited');
    if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) throw new ProviderError('provider_error');
    throw err;
  }
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const body = (await req.json().catch(() => null)) as { barbearia?: unknown; mensagens?: unknown } | null;
    const shopId = String(body?.barbearia ?? '');
    const history = validHistory(body?.mensagens);
    if (!UUID_RE.test(shopId) || !history) return json({ error: 'invalid_request' }, 400);
    const { supabase: admin } = await requireBarbershopManagement(req, shopId);

    const { data: cred, error } = await admin.from('ai_credentials').select('provedor, chave_cifrada').eq('barbershop_id', shopId).maybeSingle();
    if (error) throw error;
    if (!cred) return json({ error: 'no_key' }, 409);
    const key = await decryptSecret(cred.chave_cifrada, shopId, Deno.env.get('AI_CREDENTIALS_KEY'));

    // Consultas com o token de quem pediu (não service_role): o banco aplica as permissões dessa pessoa.
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      auth: { persistSession: false },
    });
    const shop = await loadShop(db, shopId);
    const run: RunTool = (name, args) => runTool(name, args, { db, shopId, tz: shop.tz });
    const system = systemPrompt(shop);
    const resposta = cred.provedor === 'anthropic' ? await askAnthropic(key, system, history, run) : await askOpenAI(key, system, history, run);
    return json({ resposta: resposta || 'Não consegui responder agora. Tente reformular a pergunta.' });
  } catch (err) {
    if (err instanceof AuthError) return json({ error: 'forbidden' }, err.status);
    if (err instanceof ProviderError) return json({ error: err.message }, 502);
    console.error('[assistant]', err instanceof Error ? err.message : 'erro');
    return json({ error: 'assistant_failed' }, 500);
  }
});
