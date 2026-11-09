import { supabase } from "@/lib/supabase"
import type { Session, User } from "@supabase/supabase-js"
import { rememberNext } from "../domain"

/** Usa a origem atual, para funcionar em qualquer porta ou domínio cadastrado no Supabase. */
function callbackUrl() {
  return `${window.location.origin}/auth/callback`
}

export async function signInWithGoogle(next = "/dashboard") {
  rememberNext(next)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl(),
    },
  })
  if (error) {
    throw error
  }
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw error
  }
}

/** `full_name` é só para exibição: papéis e permissões nunca vêm de `user_metadata`. */
export async function signUp(account: { nome: string; email: string; senha: string }, next = "/dashboard") {
  rememberNext(next)
  const { data, error } = await supabase.auth.signUp({
    email: account.email,
    password: account.senha,
    options: {
      emailRedirectTo: callbackUrl(),
      data: { full_name: account.nome },
    },
  })
  if (error) {
    throw error
  }
  return { needsEmailConfirmation: !data.session }
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl() })
  if (error) {
    throw error
  }
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    throw error
  }
}

export async function signOut(scope: "global" | "local" = "global") {
  const { error } = await supabase.auth.signOut({ scope })
  if (error) {
    throw error
  }
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    throw error
  }
  return data.session
}

export type AuthStateChange = {
  event: string
  session: Session | null
  user: User | null
}

export function onAuthStateChange(
  callback: (state: AuthStateChange) => void
) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback({ event, session, user: session?.user ?? null })
  })
  return data
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    throw error
  }
  return data.user
}

/** Guarda a cor de destaque na conta (vale em qualquer aparelho). É só aparência: nunca define permissões. */
export async function saveAccentPreference(choice: string) {
  const { error } = await supabase.auth.updateUser({ data: { accent: choice } })
  if (error) {
    throw error
  }
}
