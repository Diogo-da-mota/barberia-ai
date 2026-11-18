/**
 * Verificação de autenticação e autorização para Edge Functions.
 * Valida se o caller tem membership na barbearia com papel proprietario ou gerente.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';

export interface AuthContext {
  userId: string;
  barbershopId: string;
  role: 'proprietario' | 'gerente';
  supabase: SupabaseClient;
}

/**
 * Extrai o JWT do header Authorization e valida membership + papel.
 * Retorna contexto com supabase client (service_role) e dados do usuário.
 */
export async function requireBarbershopManagement(
  req: Request,
  barbershopId: string
): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Token de autorização ausente', 401);
  }

  const jwt = authHeader.slice(7);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Client com service_role (sem o token do usuário no cabeçalho: com ele o PostgREST rodaria como o usuário
  // e as gravações em integration_accounts seriam negadas). O usuário é validado abaixo por getUser(jwt).
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Valida o usuário autenticado
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) {
    throw new AuthError('Usuário não autenticado', 401);
  }

  // Verifica membership na barbearia com papel proprietario ou gerente
  const { data: membership, error: memErr } = await supabase
    .from('memberships')
    .select('papel')
    .eq('barbershop_id', barbershopId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (memErr) {
    throw new AuthError('Erro ao verificar permissão', 500);
  }
  if (!membership) {
    throw new AuthError('Usuário não é membro desta barbearia', 403);
  }
  if (!['proprietario', 'gerente'].includes(membership.papel)) {
    throw new AuthError('Acesso restrito a proprietário e gerente', 403);
  }

  return {
    userId: user.id,
    barbershopId,
    role: membership.papel as 'proprietario' | 'gerente',
    supabase,
  };
}

/**
 * Erro de autenticação/autorização com status HTTP.
 */
export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * Converte AuthError em Response JSON padronizado.
 */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  console.error('[auth] Erro não categorizado:', err);
  return new Response(JSON.stringify({ error: 'Erro interno de autenticação' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}