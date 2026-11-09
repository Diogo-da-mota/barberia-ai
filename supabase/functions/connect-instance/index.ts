/**
 * Edge Function: POST /functions/v1/connect-instance
 * Cria/reutiliza instância Evolution, configura webhook e retorna QR code.
 * Requer autenticação (proprietario/gerente da barbearia).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, withCors } from '../_shared/cors.ts';
import { requireBarbershopManagement, authErrorResponse } from '../_shared/auth.ts';
import { loadEvolutionConfig, ConfigError } from '../_shared/evolution-config.ts';
import { ensureInstanceAndGetQr, instanceNameForBarbershop } from '../_shared/evolution-instance.ts';

serve(async (req: Request) => {
  // CORS preflight
  const corsResp = handleCors(req);
  if (corsResp) return withCors(corsResp);

  if (req.method !== 'POST') {
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

    // Busca nome da barbearia e row de integration_accounts
    const { data: shop, error: shopErr } = await auth.supabase
      .from('barbershops')
      .select('id, nome')
      .eq('id', barbershop_id)
      .maybeSingle();

    if (shopErr || !shop) {
      return withCors(new Response(JSON.stringify({ error: 'Barbearia não encontrada' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    }

    // Busca ou cria row em integration_accounts
    const { data: encontrada, error: intErr } = await auth.supabase
      .from('integration_accounts')
      .select('id, evolution_instance_name, status')
      .eq('barbershop_id', barbershop_id)
      .eq('provider', 'whatsapp')
      .maybeSingle();

    if (intErr) {
      console.error('[connect] Erro ao buscar integration_accounts:', intErr.message);
      return withCors(new Response(JSON.stringify({ error: 'Erro ao acessar configuração' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    }

    let integration = encontrada;
    let instanceName = integration?.evolution_instance_name;

    // Se não existe row, cria
    if (!integration) {
      const newInstanceName = instanceNameForBarbershop(shop.nome, barbershop_id);
      const { data: newInt, error: createErr } = await auth.supabase
        .from('integration_accounts')
        .insert({
          barbershop_id,
          provider: 'whatsapp',
          status: 'nao_configurado',
          evolution_instance_name: newInstanceName,
        })
        .select('id, evolution_instance_name, status')
        .maybeSingle();

      if (createErr) {
        // Race condition: outra request criou primeiro
        if (createErr.code === '23505') { // unique_violation
          const { data: existing } = await auth.supabase
            .from('integration_accounts')
            .select('id, evolution_instance_name, status')
            .eq('barbershop_id', barbershop_id)
            .eq('provider', 'whatsapp')
            .maybeSingle();
          integration = existing;
          instanceName = existing?.evolution_instance_name;
        } else {
          console.error('[connect] Erro ao criar integration_accounts:', createErr.message);
          return withCors(new Response(JSON.stringify({ error: 'Erro ao criar configuração' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      } else {
        integration = newInt;
        instanceName = newInt?.evolution_instance_name;
      }
    }

    if (!instanceName) {
      return withCors(new Response(JSON.stringify({ error: 'Falha ao determinar instância' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    }

    // Garante instância + webhook + QR
    const result = await ensureInstanceAndGetQr(config, barbershop_id, shop.nome, instanceName);

    // Atualiza integration_accounts com instance_name (se mudou) e status
    const updateData: Record<string, unknown> = {
      evolution_instance_name: result.instanceName,
      status: result.connected ? 'ativo' : 'nao_configurado',
      atualizado_em: new Date().toISOString(),
    };
    if (result.connected) {
      updateData.display_phone_number = result.number;
      updateData.profile_name = result.profileName;
      updateData.connected_at = new Date().toISOString();
    }

    await auth.supabase
      .from('integration_accounts')
      .update(updateData)
      .eq('barbershop_id', barbershop_id)
      .eq('provider', 'whatsapp');

    // Resposta
    const response = {
      provider: 'evolution',
      connected: result.connected,
      state: result.state,
      qr: result.qr.base64, // data URL pronta para o <img>
      pairingCode: result.qr.pairingCode,
      number: result.number,
      profileName: result.profileName,
    };

    return withCors(new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  } catch (err) {
    if (err instanceof Error && err.name === 'AuthError') {
      return authErrorResponse(err);
    }
    if (err instanceof ConfigError) {
      return withCors(new Response(JSON.stringify({ error: 'WhatsApp indisponível no momento' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    }
    console.error('[connect] Erro inesperado:', err instanceof Error ? err.message : err);
    return withCors(new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  }
});