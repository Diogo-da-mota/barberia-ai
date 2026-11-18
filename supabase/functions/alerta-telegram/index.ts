/**
 * Ponte do alerta de segurança para o Telegram (migration 0055). Chamada pelo banco (pg_net, private.verificar_alertas)
 * com a chave anon, exigida pelo gateway (verify_jwt). Não recebe texto: envia só os alertas pendentes guardados no banco,
 * com o token e o chat do Vault (lidos pela service_role). Chamar de fora não manda nada novo.
 * Publicar: supabase functions deploy alerta-telegram --use-api   (com JWT, como as demais)
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { enviarAlertasPendentes } from '../_shared/alerta-telegram.ts';

serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error ? { message: error.message } : null };
  };
  try {
    return Response.json(await enviarAlertasPendentes(rpc, fetch));
  } catch (err) {
    console.error('[alerta-telegram]', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'falha' }, { status: 500 });
  }
});
