/**
 * Edge Function: POST /functions/v1/evolution-webhook
 * Endpoint público para receber webhooks da Evolution API.
 * Valida x-webhook-secret e processa CONNECTION_UPDATE / MESSAGES_UPSERT.
 * NÃO requer autenticação de usuário (usa secret do webhook).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { handleCors, withCors } from '../_shared/cors.ts';
import { loadEvolutionConfig, ConfigError } from '../_shared/evolution-config.ts';
import { EVOLUTION_SECRET_HEADER, evoSendText } from '../_shared/evolution-client.ts';
import { replyAck, rescheduleLink } from '../_shared/messages.ts';
import { safeEqual } from '../_shared/webhook.ts';
import { parseEvolutionMessage } from '../_shared/webhook.ts';

serve(async (req: Request) => {
  // CORS preflight (útil para testes locais)
  const corsResp = handleCors(req);
  if (corsResp) return withCors(corsResp);

  if (req.method !== 'POST') {
    return withCors(new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405, headers: { 'Content-Type': 'application/json' } }));
  }

  try {
    // Carrega config da Evolution (precisa do webhook_secret)
    let config;
    try {
      config = loadEvolutionConfig();
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error('[webhook] Configuração ausente:', err.message);
        return withCors(new Response(JSON.stringify({ error: 'Serviço indisponível' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      }
      throw err;
    }

    // Valida x-webhook-secret
    const providedSecret = req.headers.get(EVOLUTION_SECRET_HEADER);
    if (!providedSecret || !safeEqual(providedSecret, config.webhookSecret)) {
      console.warn('[webhook] Secret inválido ou ausente');
      return withCors(new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    }

    // Parse payload
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return withCors(new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    }

    // A Evolution v2 manda "messages.upsert"; aceita também "MESSAGES_UPSERT"
    const event = (payload as { event?: string })?.event?.toUpperCase().replace(/\./g, '_');
    const instanceName = (payload as { instance?: string })?.instance;
    const data = (payload as { data?: unknown })?.data;

    if (!event || !instanceName) {
      return withCors(new Response(JSON.stringify({ error: 'Payload inválido: event e instance obrigatórios' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    }

    console.log(`[webhook] ${event} - ${instanceName}`);

    // Supabase client com service_role (para escrita direta)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Busca barbershop_id pelo instanceName
    const { data: integration, error: intErr } = await supabase
      .from('integration_accounts')
      .select('barbershop_id, evolution_instance_name')
      .eq('provider', 'whatsapp')
      .eq('evolution_instance_name', instanceName)
      .maybeSingle();

    if (intErr) {
      console.error('[webhook] Erro ao buscar integration_accounts:', intErr.message);
      return withCors(new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    }

    if (!integration) {
      // Instância não mapeada no nosso sistema — ignora silenciosamente
      console.warn(`[webhook] Instância não mapeada: ${instanceName}`);
      return withCors(new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    const barbershopId = integration.barbershop_id;

    // Processa por tipo de evento
    switch (event) {
      case 'CONNECTION_UPDATE': {
        await handleConnectionUpdate(supabase, barbershopId, instanceName, data);
        break;
      }
      case 'MESSAGES_UPSERT': {
        // SIM registra a presença, NÃO registra (sem cancelar), PARAR bloqueia: regra, duplicidade e correlação em
        // process_whatsapp_reply (0027). Mensagens da própria barbearia (fromMe) não chegam aqui: parseEvolutionMessage dá null.
        const reply = parseEvolutionMessage(data);
        if (reply) {
          const { data: resultado, error } = await supabase.rpc('process_whatsapp_reply', {
            p_event_id: reply.eventId, p_ts: reply.ts.toISOString(), p_from: reply.from,
            p_context_message_id: reply.contextId, p_texto: reply.text, p_barbershop_id: barbershopId,
          });
          if (error) console.error('[webhook] process_whatsapp_reply falhou', error.code); // sem texto nem número nos logs
          else console.log(`[webhook] resposta: ${resultado}`);
          // só o evento que acabou de ser processado responde: reenvio da Evolution vira 'duplicado' e 2º SIM, 'ja_respondido'
          if (resultado === 'processado') await acknowledge(supabase, config, instanceName, barbershopId, reply.eventId, reply.from);
        }
        await handleMessagesUpsert(supabase, barbershopId, instanceName, data);
        break;
      }
      case 'MESSAGES_UPDATE': {
        // Opcional: atualizações de status de mensagem (lido, etc.)
        await handleMessagesUpdate(supabase, barbershopId, instanceName, data);
        break;
      }
      case 'CHATS_DELETE': {
        // Opcional: limpeza se chat for deletado
        break;
      }
      default:
        console.log(`[webhook] Evento não tratado: ${event}`);
    }

    return withCors(new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  } catch (err) {
    if (err instanceof ConfigError) {
      console.error('[webhook] Configuração ausente:', err.message);
      return withCors(new Response(JSON.stringify({ error: 'Serviço indisponível' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    }
    console.error('[webhook] Erro inesperado:', err instanceof Error ? err.message : err);
    return withCors(new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
  }
});

/**
 * Responde pela mesma instância ao número que respondeu (já conferido com a reserva): agradece o SIM, pergunta sobre reagendar no NÃO,
 * manda o link da área do cliente no 2º SIM e avisa que a barbearia saberá no 2º NÃO. Link = segredo APP_URL + slug da barbearia.
 */
async function acknowledge(
  supabase: SupabaseClient,
  config: ReturnType<typeof loadEvolutionConfig>,
  instanceName: string,
  barbershopId: string,
  eventId: string,
  from: string
): Promise<void> {
  try {
    const { data: evento } = await supabase
      .from('inbound_webhook_events')
      .select('motivo, booking_id, barbershops(nome, slug)')
      .eq('provider', 'whatsapp')
      .eq('event_id', eventId)
      .eq('barbershop_id', barbershopId)
      .maybeSingle();
    const loja = evento?.barbershops as { nome?: string; slug?: string } | null;
    const appUrl = Deno.env.get('APP_URL') ?? '';
    if (evento?.motivo === 'reagendar' && !appUrl) console.error('[webhook] APP_URL ausente: link de reagendamento não enviado');
    const link = appUrl && loja?.slug && evento?.booking_id ? rescheduleLink(appUrl, loja.slug, evento.booking_id) : null;
    const texto = loja?.nome ? replyAck(evento?.motivo, loja.nome, link) : null;
    if (!texto) return;
    await evoSendText(config, instanceName, { number: from, text: texto });
    console.log(`[webhook] resposta automática: ${evento?.motivo}`);
  } catch (err) {
    console.error('[webhook] resposta automática falhou:', err instanceof Error ? err.message : 'erro');
  }
}

/**
 * CONNECTION_UPDATE: estado da conexão mudou (conectou/desconectou).
 * Atualiza integration_accounts e, se conectou, registra número/perfil.
 */
async function handleConnectionUpdate(
  supabase: SupabaseClient,
  barbershopId: string,
  instanceName: string,
  data: unknown
): Promise<void> {
  const d = data as { state?: string; number?: string; profileName?: string; qrcode?: unknown };
  const state = d?.state ?? 'close';
  const connected = state === 'open';

  const updateData: Record<string, unknown> = {
    status: connected ? 'ativo' : 'nao_configurado',
    atualizado_em: new Date().toISOString(),
  };

  if (connected) {
    if (d?.number) updateData.display_phone_number = d.number;
    if (d?.profileName) updateData.profile_name = d.profileName;
    updateData.connected_at = new Date().toISOString();
  }

  await supabase
    .from('integration_accounts')
    .update(updateData)
    .eq('barbershop_id', barbershopId)
    .eq('provider', 'whatsapp');

  console.log(`[webhook] CONNECTION_UPDATE: ${instanceName} → ${state}`);
}

/**
 * MESSAGES_UPSERT: mensagem nova (recebida ou enviada).
 * Insere/atualiza em messaging_messages para a Central de Mensagens.
 */
async function handleMessagesUpsert(
  supabase: SupabaseClient,
  barbershopId: string,
  instanceName: string,
  data: unknown
): Promise<void> {
  const d = data as {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string };
    message?: unknown;
    messageTimestamp?: number;
    pushName?: string;
    status?: string;
  };

  if (!d?.key?.remoteJid || !d?.message) return;

  const remoteJid = d.key.remoteJid; // ex: "5511999999999@s.whatsapp.net"
  const fromMe = d.key.fromMe === true;
  const msgId = d.key.id ?? crypto.randomUUID();
  const timestamp = d.messageTimestamp ? new Date(d.messageTimestamp * 1000).toISOString() : new Date().toISOString();
  const status = d.status ?? (fromMe ? 'sent' : 'received');

  // Extrai texto da mensagem (simplificado — Evolution envia objeto message complexo)
  let text = '';
  const msg = d.message as {
    conversation?: unknown; extendedTextMessage?: { text?: string }; imageMessage?: { caption?: string };
    videoMessage?: { caption?: string }; documentMessage?: { caption?: string }; audioMessage?: unknown; stickerMessage?: unknown;
    locationMessage?: unknown; contactMessage?: unknown; reactionMessage?: unknown; protocolMessage?: unknown;
  } | null;
  if (msg) {
    if (typeof msg.conversation === 'string') text = msg.conversation;
    else if (msg.extendedTextMessage?.text) text = msg.extendedTextMessage.text as string;
    else if (msg.imageMessage?.caption) text = `[Imagem] ${msg.imageMessage.caption}`;
    else if (msg.videoMessage?.caption) text = `[Vídeo] ${msg.videoMessage.caption}`;
    else if (msg.documentMessage?.caption) text = `[Documento] ${msg.documentMessage.caption}`;
    else if (msg.audioMessage) text = '[Áudio]';
    else if (msg.stickerMessage) text = '[Sticker]';
    else if (msg.locationMessage) text = '[Localização]';
    else if (msg.contactMessage) text = '[Contato]';
    else if (msg.reactionMessage) text = '[Reação]';
    else if (msg.protocolMessage) text = '[Mensagem de protocolo]';
    else text = '[Mensagem não suportada]';
  }

  // Normaliza número: remove @s.whatsapp.net, :<agent>, apenas dígitos
  const normalizedNumber = remoteJid
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');

  // Tenta achar conversa existente ou criar
  let { data: conversation } = await supabase
    .from('messaging_conversations')
    .select('id, remote_name, unread_count')
    .eq('barbershop_id', barbershopId)
    .eq('channel', 'whatsapp')
    .eq('remote_number', normalizedNumber)
    .maybeSingle();

  if (!conversation) {
    const { data: newConv, error: convErr } = await supabase
      .from('messaging_conversations')
      .insert({
        barbershop_id: barbershopId,
        channel: 'whatsapp',
        remote_number: normalizedNumber,
        remote_name: d.pushName ?? null,
        status: 'open',
        unread_count: fromMe ? 0 : 1,
        last_message_at: timestamp,
        last_message_preview: text.slice(0, 120),
      })
      .select('id, remote_name, unread_count')
      .maybeSingle();

    if (convErr) {
      console.error('[webhook] Erro ao criar conversa:', convErr.message);
      return;
    }
    conversation = newConv;
  } else {
    // Atualiza conversa (unread, last_message)
    const unreadIncrement = fromMe ? 0 : 1;
    await supabase
      .from('messaging_conversations')
      .update({
        remote_name: d.pushName ?? conversation.remote_name,
        status: 'open',
        unread_count: (conversation.unread_count ?? 0) + unreadIncrement,
        last_message_at: timestamp,
        last_message_preview: text.slice(0, 120),
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', conversation.id);
  }

  if (!conversation) return;

  // Insere mensagem
  await supabase
    .from('messaging_messages')
    .upsert({
      conversation_id: conversation.id,
      direction: fromMe ? 'outbound' : 'inbound',
      content: text,
      message_type: 'text',
      status,
      evolution_message_id: msgId,
      sent_at: timestamp,
      raw_payload: d,
    }, { onConflict: 'conversation_id,evolution_message_id' });

  console.log(`[webhook] MESSAGES_UPSERT: ${fromMe ? 'outbound' : 'inbound'}`); // sem telefone nos logs (OPERACAO.md)
}

/**
 * MESSAGES_UPDATE: atualização de status (lido, entregue, etc.).
 */
async function handleMessagesUpdate(
  supabase: SupabaseClient,
  barbershopId: string,
  instanceName: string,
  data: unknown
): Promise<void> {
  const d = data as {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string };
    status?: string;
  };

  if (!d?.key?.id || !d?.key?.remoteJid) return;

  const remoteJid = d.key.remoteJid;
  const normalizedNumber = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
  const status = d.status ?? 'delivered';

  // Atualiza status da mensagem
  const { data: conversation } = await supabase
    .from('messaging_conversations')
    .select('id')
    .eq('barbershop_id', barbershopId)
    .eq('channel', 'whatsapp')
    .eq('remote_number', normalizedNumber)
    .maybeSingle();

  if (conversation) {
    await supabase
      .from('messaging_messages')
      .update({ status })
      .eq('conversation_id', conversation.id)
      .eq('evolution_message_id', d.key.id);
  }
}
