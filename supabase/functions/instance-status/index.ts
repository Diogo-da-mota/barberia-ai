/**
 * Edge Function: GET /functions/v1/instance-status
 * Retorna estado atual da instância Evolution (para polling do QR).
 * Requer autenticação (proprietario/gerente da barbearia).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, withCors } from '../_shared/cors.ts';
import { requireBarbershopManagement, authErrorResponse } from '../_shared/auth.ts';
import { loadEvolutionConfig, ConfigError } from '../_shared/evolution-config.ts';
import { getInstanceStatus } from '../_shared/evolution-instance.ts';

serve(async (req: Request) => {
  // CORS preflight
  const corsResp = handleCors(req);
  if (corsResp) return withCors(corsResp);

  if (req.method !== 'GET') {
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

    // Extrai barbershop_id da query string
    const url = new URL(req.url);
    const barbershopId = url.searchParams.get('barbershop_id');
    if (!barbershopId) {
      return withCors(new Response(JSON.stringify({ error: 'barbershop_id obrigatório' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    }

    // Autentica e autoriza
    const auth = await requireBarbershopManagement(req, barbershopId);

    // Busca integration_accounts
    const { data: integration, error } = await auth.supabase
      .from('integration_accounts')
      .select('evolution_instance_name, status, display_phone_number, profile_name, connected_at')
      .eq('barbershop_id', barbershopId)
      .eq('provider', 'whatsapp')
      .maybeSingle();

    if (error) {
      console.error('[status] Erro ao buscar integration_accounts:', error.message);
      return withCors(new Response(JSON.stringify({ error: 'Erro ao acessar configuração' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    }

    if (!integration || !integration.evolution_instance_name) {
      // Sem instância configurada
      return withCors(new Response(JSON.stringify({ provider: null, connected: false, state: 'not_found', number: null, profileName: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    // Busca estado vivo na Evolution
    const live = await getInstanceStatus(config, integration.evolution_instance_name);

    if (!live) {
      // Evolution inacessível — retorna cache
      return withCors(new Response(JSON.stringify({
        provider: 'evolution',
        connected: integration.status === 'ativo',
        state: integration.status,
        number: integration.display_phone_number,
        profileName: integration.profile_name,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    // Se conectou agora, atualiza cache
    if (live.connected && integration.status !== 'ativo') {
      await auth.supabase
        .from('integration_accounts')
        .update({
          status: 'ativo',
          display_phone_number: live.number,
          profile_name: live.profileName,
          connected_at: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        })
        .eq('barbershop_id', barbershopId)
        .eq('provider', 'whatsapp');
    }

    return withCors(new Response(JSON.stringify({
      provider: 'evolution',
      connected: live.connected,
      state: live.state,
      number: live.number,
      profileName: live.profileName,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  } catch (err) {
    if (err instanceof Error && err.name === 'AuthError') {
      return authErrorResponse(err);
    }
    if (err instanceof ConfigError) {
      return withCors(new Response(JSON.stringify({ error: 'WhatsApp indisponível no momento' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    }
    console.error('[status] Erro inesperado:', err instanceof Error ? err.message : err);
    return withCors(new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  }
});