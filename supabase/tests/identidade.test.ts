// @vitest-environment node
//
// Testes de RLS, papéis e isolamento multiempresa (F02-03, F02-04, F02-06).
// Rodam em um PostgreSQL local (PGlite): nada toca o projeto remoto do Supabase.
// O ambiente do Supabase é simulado só no necessário: roles anon/authenticated,
// auth.users, auth.uid() e os privilégios padrão que o Supabase concede às tabelas.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite()

const ID = {
  dono: "00000000-0000-4000-8000-00000000000a",
  donoB: "00000000-0000-4000-8000-00000000000b",
  gerente: "00000000-0000-4000-8000-00000000000c",
  barbeiro: "00000000-0000-4000-8000-00000000000d",
  cliente: "00000000-0000-4000-8000-00000000000e",
  estranho: "00000000-0000-4000-8000-00000000000f",
}
const EMAIL = {
  gerente: "gerente@example.test",
  barbeiro: "barbeiro@example.test",
  cliente: "cliente@example.test",
}

let lojaA = ""
let lojaB = ""

/** Executa como um usuário autenticado (ou anônimo, com null), como o PostgREST faria. */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.exec(`set role ${user ? "authenticated" : "anon"}`)
  try {
    return await fn()
  } finally {
    await db.exec("reset role")
  }
}

const rows = async (user: string | null, sql: string, params: unknown[] = []) =>
  as(user, async () => (await db.query<Record<string, unknown>>(sql, params)).rows)

const scalar = async (user: string | null, sql: string, params: unknown[] = []) => {
  const [row] = await rows(user, sql, params)
  return Object.values(row)[0]
}

beforeAll(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      email_confirmed_at timestamptz default now(),
      raw_user_meta_data jsonb not null default '{}'
    );
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  await db.exec(readFileSync(process.env.MIGRATION_FILE ?? "supabase/migrations/0001_identidade_inicial.sql", "utf8"))

  const users: [string, string | null, Record<string, unknown>][] = [
    [ID.dono, "dono@example.test", { full_name: "Dono A" }],
    [ID.donoB, "dono-b@example.test", { full_name: "Dono B" }],
    [ID.gerente, EMAIL.gerente, { full_name: "Gerente A" }],
    [ID.barbeiro, EMAIL.barbeiro, { full_name: "Barbeiro A" }],
    [ID.cliente, EMAIL.cliente, { full_name: "Cliente A" }],
    [ID.estranho, "estranho@example.test", {}],
  ]
  for (const [id, email, meta] of users) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, meta])
  }

  lojaA = (await scalar(ID.dono, "select create_barbershop('Barbearia A', 'barbearia-a')")) as string
  lojaB = (await scalar(ID.donoB, "select create_barbershop('Barbearia B', 'barbearia-b')")) as string

  const convidar = async (email: string, papel: string) =>
    (await scalar(ID.dono, "select create_invite($1, $2, $3)", [lojaA, email, papel])) as string
  const tokenGerente = await convidar(EMAIL.gerente, "gerente")
  const tokenBarbeiro = await convidar(EMAIL.barbeiro, "barbeiro")
  await rows(ID.gerente, "select accept_invite($1)", [tokenGerente])
  await rows(ID.barbeiro, "select accept_invite($1)", [tokenBarbeiro])
  // O vínculo de cliente nasce na primeira reserva (F04/F05); aqui é só preparação do teste.
  await db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'cliente')", [lojaA, ID.cliente])
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("F02-04: criar barbearia e primeiro proprietário", () => {
  it("o usuário autenticado vira proprietário da barbearia criada", async () => {
    const [vinculo] = await rows(ID.dono, "select papel from memberships where barbershop_id = $1", [lojaA])
    expect(vinculo).toEqual({ papel: "proprietario" })
    expect(await scalar(ID.dono, "select owner_id from barbershops where id = $1", [lojaA])).toBe(ID.dono)
  })

  it("registra a criação na auditoria", async () => {
    const [log] = await rows(ID.dono, "select acao from audit_logs where barbershop_id = $1", [lojaA])
    expect(log.acao).toBe("barbershop.created")
  })

  it("anônimo não executa a função", async () => {
    await expect(rows(null, "select create_barbershop('X', 'barbearia-x')")).rejects.toThrow(/permission denied/)
  })

  it("rejeita slug inválido ou repetido", async () => {
    await expect(rows(ID.estranho, "select create_barbershop('X', 'Slug Ruim')")).rejects.toThrow(/slug/)
    await expect(rows(ID.estranho, "select create_barbershop('X', 'barbearia-a')")).rejects.toThrow(/unique|duplicate/i)
  })

  it("o perfil é criado junto com a conta, com o nome só para exibição", async () => {
    expect(await scalar(ID.dono, "select nome from profiles where id = $1", [ID.dono])).toBe("Dono A")
    expect(await scalar(ID.estranho, "select nome from profiles where id = $1", [ID.estranho])).toBe("estranho")
  })
})

describe("T03: empresa A não lê nem altera a empresa B", () => {
  it("cada proprietário enxerga só a própria barbearia", async () => {
    expect(await rows(ID.dono, "select id from barbershops")).toEqual([{ id: lojaA }])
    expect(await rows(ID.donoB, "select id from barbershops")).toEqual([{ id: lojaB }])
  })

  it("não lê vínculos, auditoria nem perfis da outra empresa", async () => {
    expect(await rows(ID.dono, "select 1 from memberships where barbershop_id = $1", [lojaB])).toHaveLength(0)
    expect(await rows(ID.dono, "select 1 from audit_logs where barbershop_id = $1", [lojaB])).toHaveLength(0)
    expect(await rows(ID.dono, "select 1 from profiles where id = $1", [ID.donoB])).toHaveLength(0)
  })

  it("não altera a outra barbearia", async () => {
    const changed = await rows(ID.dono, "update barbershops set nome = 'Invadida' where id = $1 returning id", [lojaB])
    expect(changed).toHaveLength(0)
    expect(await scalar(ID.donoB, "select nome from barbershops where id = $1", [lojaB])).toBe("Barbearia B")
  })

  it("não convida para a outra barbearia", async () => {
    await expect(rows(ID.dono, "select create_invite($1, 'x@example.test', 'barbeiro')", [lojaB])).rejects.toThrow(/forbidden/)
  })

  it("o gerente vê os perfis da própria barbearia e de mais ninguém", async () => {
    const ids = (await rows(ID.gerente, "select id from profiles")).map((r) => r.id)
    expect(ids.sort()).toEqual([ID.dono, ID.gerente, ID.barbeiro, ID.cliente].sort())
  })
})

describe("T01: cliente não acessa a gestão", () => {
  it("só enxerga o próprio vínculo", async () => {
    expect(await rows(ID.cliente, "select profile_id from memberships")).toEqual([{ profile_id: ID.cliente }])
  })

  it("não vê auditoria nem convites e não altera a barbearia", async () => {
    expect(await rows(ID.cliente, "select 1 from audit_logs")).toHaveLength(0)
    expect(await rows(ID.cliente, "select id from invites")).toHaveLength(0)
    expect(await rows(ID.cliente, "update barbershops set nome = 'X' where id = $1 returning id", [lojaA])).toHaveLength(0)
  })

  it("não cria convites", async () => {
    await expect(rows(ID.cliente, "select create_invite($1, 'x@example.test', 'barbeiro')", [lojaA])).rejects.toThrow(/forbidden/)
  })

  it("não vê o perfil de outros clientes", async () => {
    expect(await rows(ID.cliente, "select id from profiles")).toEqual([{ id: ID.cliente }])
  })
})

describe("T02: barbeiro só enxerga o que é dele", () => {
  it("não vê vínculos de colegas, auditoria nem perfis alheios", async () => {
    expect(await rows(ID.barbeiro, "select profile_id from memberships")).toEqual([{ profile_id: ID.barbeiro }])
    expect(await rows(ID.barbeiro, "select 1 from audit_logs")).toHaveLength(0)
    expect(await rows(ID.barbeiro, "select id from profiles")).toEqual([{ id: ID.barbeiro }])
  })

  it("enxerga a barbearia onde trabalha", async () => {
    expect(await rows(ID.barbeiro, "select id from barbershops")).toEqual([{ id: lojaA }])
  })
})

describe("T04: ninguém eleva o próprio papel", () => {
  it("não altera, cria nem apaga vínculos", async () => {
    await expect(rows(ID.cliente, "update memberships set papel = 'proprietario' where profile_id = $1", [ID.cliente])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.cliente, "insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'proprietario')", [lojaA, ID.cliente])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.donoB, "insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'gerente')", [lojaA, ID.donoB])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.gerente, "delete from memberships where profile_id = $1", [ID.dono])).rejects.toThrow(/permission denied/)
  })

  it("não cria barbearia por insert direto", async () => {
    await expect(rows(ID.estranho, "insert into barbershops (owner_id, nome, slug) values ($1, 'X', 'barbearia-y')", [ID.estranho])).rejects.toThrow(/permission denied/)
  })

  it("o gerente não troca dono, slug nem status", async () => {
    await expect(rows(ID.gerente, "update barbershops set owner_id = $1 where id = $2", [ID.gerente, lojaA])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.gerente, "update barbershops set slug = 'tomada' where id = $1", [lojaA])).rejects.toThrow(/permission denied/)
    await expect(rows(ID.gerente, "update barbershops set status = 'inativo' where id = $1", [lojaA])).rejects.toThrow(/permission denied/)
  })

  it("o gerente edita os dados cadastrais", async () => {
    await rows(ID.gerente, "update barbershops set nome = 'Barbearia A Nova' where id = $1", [lojaA])
    expect(await scalar(ID.dono, "select nome from barbershops where id = $1", [lojaA])).toBe("Barbearia A Nova")
  })

  it("user_metadata editável não concede acesso", async () => {
    await db.query(`update auth.users set raw_user_meta_data = '{"role":"admin","papel":"proprietario","barbershop_id":"${lojaA}"}' where id = $1`, [ID.estranho])
    expect(await rows(ID.estranho, "select id from barbershops")).toHaveLength(0)
    expect(await rows(ID.estranho, "select 1 from memberships")).toHaveLength(0)
  })

  it("um perfil só altera nome e foto, e só o próprio", async () => {
    await expect(rows(ID.cliente, "update profiles set email = 'outro@example.test' where id = $1", [ID.cliente])).rejects.toThrow(/permission denied/)
    expect(await rows(ID.cliente, "update profiles set nome = 'Outro' where id = $1 returning id", [ID.dono])).toHaveLength(0)
  })

  it("a barbearia tem um único proprietário", async () => {
    await expect(db.query("insert into memberships (barbershop_id, profile_id, papel) values ($1, $2, 'proprietario')", [lojaA, ID.estranho])).rejects.toThrow(/unique|duplicate/i)
  })

  it("anônimo não lê nenhuma tabela", async () => {
    for (const table of ["profiles", "barbershops", "memberships", "invites", "audit_logs"]) {
      await expect(rows(null, `select 1 from ${table}`)).rejects.toThrow(/permission denied/)
    }
  })
})

describe("F02-05: convites", () => {
  it("o aceite cria o vínculo com o papel convidado", async () => {
    expect(await rows(ID.dono, "select papel from memberships where profile_id = $1 and barbershop_id = $2", [ID.gerente, lojaA])).toEqual([{ papel: "gerente" }])
    expect(await rows(ID.dono, "select papel from memberships where profile_id = $1 and barbershop_id = $2", [ID.barbeiro, lojaA])).toEqual([{ papel: "barbeiro" }])
  })

  it("só o proprietário convida gerente; o gerente convida barbeiro", async () => {
    await expect(rows(ID.gerente, "select create_invite($1, 'novo@example.test', 'gerente')", [lojaA])).rejects.toThrow(/forbidden/)
    expect(await scalar(ID.gerente, "select create_invite($1, 'novo@example.test', 'barbeiro')", [lojaA])).toBeTruthy()
    await expect(rows(ID.dono, "select create_invite($1, 'novo@example.test', 'proprietario')", [lojaA])).rejects.toThrow(/invalid_role/)
  })

  it("o token nunca é legível e fica guardado só como hash", async () => {
    await expect(rows(ID.dono, "select token_hash from invites")).rejects.toThrow(/permission denied/)
    const token = (await scalar(ID.dono, "select create_invite($1, 'hash@example.test', 'barbeiro')", [lojaA])) as string
    const [{ ok }] = (await db.query<{ ok: boolean }>("select token_hash = encode(sha256(convert_to($1, 'utf8')), 'hex') and token_hash <> $1 as ok from invites where email = 'hash@example.test'", [token])).rows
    expect(ok).toBe(true)
  })

  it("rejeita token inexistente, e de outro email, sem distinguir o motivo", async () => {
    const token = (await scalar(ID.dono, "select create_invite($1, 'outra-pessoa@example.test', 'barbeiro')", [lojaA])) as string
    await expect(rows(ID.estranho, "select accept_invite('token-que-nao-existe')")).rejects.toThrow(/invalid_invite/)
    await expect(rows(ID.estranho, "select accept_invite($1)", [token])).rejects.toThrow(/invalid_invite/)
  })

  it("o token vale uma única vez e expira", async () => {
    const token = (await scalar(ID.dono, "select create_invite($1, $2, 'barbeiro')", [lojaA, "estranho@example.test"])) as string
    await db.query("update invites set expires_at = now() - interval '1 minute' where email = 'estranho@example.test'")
    await expect(rows(ID.estranho, "select accept_invite($1)", [token])).rejects.toThrow(/invalid_invite/)

    const novo = (await scalar(ID.dono, "select create_invite($1, $2, 'barbeiro')", [lojaA, "estranho@example.test"])) as string
    await rows(ID.estranho, "select accept_invite($1)", [novo])
    await expect(rows(ID.estranho, "select accept_invite($1)", [novo])).rejects.toThrow(/invalid_invite|already_member/)
  })

  it("email não confirmado não aceita convite", async () => {
    await db.query("insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-0000000000aa', 'pendente@example.test', null)")
    const token = (await scalar(ID.dono, "select create_invite($1, 'pendente@example.test', 'barbeiro')", [lojaA])) as string
    await expect(rows("00000000-0000-4000-8000-0000000000aa", "select accept_invite($1)", [token])).rejects.toThrow(/invalid_invite/)
  })
})
