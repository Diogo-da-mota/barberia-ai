/**
 * Edge Function: DELETE /functions/v1/disconnect-instance
 * Desconecta e deleta instância Evolution + remove row de integration_accounts.
 * Requer autenticação (proprietario/gerente da barbearia).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, withCors } from '../_shared/cors.ts';
import { requireBarbershopManagement, authErrorResponse } from '../_shared/auth.ts';
import { loadEvolutionConfig, ConfigError } from '../_shared/evolution-config.ts';
import { disconnectAndDeleteInstance } from '../_shared/evolution-instance.ts';

serve(async (req: Request) => {
  // CORS preflight
  const corsResp = handleCors(req);
  if (corsResp) return withCors(corsResp);

  if (req.method !== 'DELETE') {
    return withCors(new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405, headers: { 'Content-Type': 'application/json' } }));
  }

  try {
    // Carrega config da Evolution
    let config;
    try {
      config = loadEvolutionConfig();
    } catch (err) {
      if (err instanceof ConfigError) {
        return withCors(new Response(JSON.stringify({ error: 'WhatsApp indisponível no momento' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      }
      throw err;
    }

    // Parse body
    let body: { barbershop_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      return withCors(new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    }

    const { barbershop_id } = body;
    if (!barbershop_id) {
      return withCors(new Response(JSON.stringify({ error: 'barbershop_id obrigatório' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    }

    // Autentica e autoriza
    const auth = await requireBarbershopManagement(req, barbershop_id);

    // Busca integration_accounts
    const { data: integration, error } = await auth.supabase
      .from('integration_accounts')
      .select('evolution_instance_name')
      .eq('barbershop_id', barbershop_id)
      .eq('provider', 'whatsapp')
      .maybeSingle();

    if (error) {
      console.error('[disconnect] Erro ao buscar integration_accounts:', error.message);
      return withCors(new Response(JSON.stringify({ error: 'Erro ao acessar configuração' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    }

    if (integration?.evolution_instance_name) {
      // Desconecta e deleta na Evolution
      await disconnectAndDeleteInstance(config, integration.evolution_instance_name);
    }

    // Remove row de integration_accounts
    await auth.supabase
      .from('integration_accounts')
      .delete()
      .eq('barbershop_id', barbershop_id)
      .eq('provider', 'whatsapp');

    return withCors(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  } catch (err) {
    if (err instanceof Error && err.name === 'AuthError') {
      return authErrorResponse(err);
    }
    if (err instanceof ConfigError) {
      return withCors(new Response(JSON.stringify({ error: 'WhatsApp indisponível no momento' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    }
    console.error('[disconnect] Erro inesperado:', err instanceof Error ? err.message : err);
    return withCors(new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  }
});