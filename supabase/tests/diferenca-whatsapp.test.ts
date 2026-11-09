/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Tarefa A1 (DIAGNOSTICO_WHATSAPP_N8N.md): supabase/aplicar/diferenca-whatsapp.sql alinha produção ao repositório.
// Reproduz em PGlite o estado lido do remoto em 2026-11-07: todas as migrations, sem phone_blocklist e com o claim_outbox antigo.
// Nada aqui toca o banco remoto.
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const SCRIPT = "supabase/aplicar/diferenca-whatsapp.sql"
const FIXTURE = "supabase/tests/fixtures/remoto-claim_outbox.sql"

const U = (n: string) => `00000000-0000-4000-8000-0000000000${n}`
const ID = { dono: U("a1"), cli1: U("d1") }

// Mesmo ambiente do Supabase: tudo que é criado em public nasce com privilégio para os três papéis, até ser revogado.
const AMBIENTE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

async function bancoComMigrations(): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } })
  await db.exec(AMBIENTE)
  // A1 alinhou produção às migrations até a 0014; as seguintes têm testes próprios
  for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql") && x.slice(0, 4) <= "0014").sort()) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
  }
  return db
}

const CATALOGO: Record<string, string> = {
  funcoes: `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' k,
      jsonb_build_object('src', regexp_replace(p.prosrc,'\\s+',' ','g'),'secdef',p.prosecdef,'cfg',p.proconfig,'ret',pg_get_function_result(p.oid),
        'anon',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute')) v
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1`,
  colunas: `select n.nspname||'.'||c.relname||'.'||a.attname k, jsonb_build_object('tipo',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'def',pg_get_expr(d.adbin,d.adrelid)) v
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where n.nspname in ('public','private') and c.relkind='r' and a.attnum>0 and not a.attisdropped order by 1`,
  constraints: `select n.nspname||'.'||c.relname||'.'||k.conname k, to_jsonb(pg_get_constraintdef(k.oid)) v
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') order by 1`,
  indices: `select schemaname||'.'||indexname k, to_jsonb(indexdef) v from pg_indexes where schemaname in ('public','private') order by 1`,
  rls: `select n.nspname||'.'||c.relname k, to_jsonb(c.relrowsecurity) v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' order by 1`,
  politicas: `select schemaname||'.'||tablename||'.'||policyname k, jsonb_build_object('cmd',cmd,'qual',qual,'check',with_check) v from pg_policies where schemaname in ('public','private') order by 1`,
  triggers: `select n.nspname||'.'||c.relname||'.'||t.tgname k, to_jsonb(pg_get_triggerdef(t.oid)) v
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and not t.tgisinternal order by 1`,
  privilegios: `select n.nspname||'.'||c.relname||'.'||r.papel||'.'||pr.priv k, to_jsonb(has_table_privilege(r.papel,c.oid,pr.priv)) v
    from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values ('anon'),('authenticated'),('service_role')) r(papel)
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) pr(priv) where n.nspname in ('public','private') and c.relkind='r' order by 1`,
}

async function catalogo(db: PGlite): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [nome, q] of Object.entries(CATALOGO)) {
    const rows = (await db.query<{ k: string; v: unknown }>(q)).rows
    out[nome] = Object.fromEntries(rows.map((r) => [r.k, r.v]))
  }
  return out
}

let db: PGlite
let referencia: PGlite
let loja = "", corte = "", ana = ""
let seq = 0

async function as<T>(role: "anon" | "authenticated" | "service_role", user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec("reset role")
  }
}
const sql = async (q: string, p: unknown[] = []) => (await db.query<Record<string, any>>(q, p)).rows
const svc = (q: string, p: unknown[] = []) => as("service_role", null, () => sql(q, p))
const autenticado = (q: string, p: unknown[] = [], user: string = ID.dono) => as("authenticated", user, () => sql(q, p))
const anonimo = (q: string, p: unknown[] = []) => as("anon", null, () => sql(q, p))

/** Evento direto na fila, com a mesma forma que o gatilho da reserva grava. */
async function evento(destino: string, extra: { status?: string; canal?: string; atualizado?: string } = {}): Promise<string> {
  seq += 1
  const [r] = await sql(
    `insert into outbox_events (barbershop_id, tipo, canal, destino, dedup_key, status, atualizado_em)
     values ($1, 'reserva_criada', $2, $3, $4, $5, coalesce($6::timestamptz, now())) returning id`,
    [loja, extra.canal ?? "whatsapp", destino, `teste:${seq}`, extra.status ?? "pendente", extra.atualizado ?? null],
  )
  return r.id
}
const estado = async (id: string) => (await sql("select status, ultimo_erro from outbox_events where id = $1", [id]))[0]
const reivindicar = async () => (await svc("select id from claim_outbox(200)")).map((r) => r.id as string)
/** Cada caso começa com a fila e os bloqueios vazios, para os limites por número não vazarem entre testes. */
const limpar = async () => {
  await sql("delete from outbox_events")
  await sql("delete from phone_blocklist")
}

beforeAll(async () => {
  referencia = await bancoComMigrations()
  db = await bancoComMigrations()

  for (const [n, id] of Object.entries(ID)) await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${n}@example.test`, { full_name: n }])
  loja = (await autenticado("select create_barbershop('Barbearia A', 'barbearia-a') id"))[0].id
  corte = (await autenticado("insert into services (barbershop_id, nome, preco_centavos, duracao_min) values ($1, 'Corte', 6000, 40) returning id", [loja]))[0].id
  ana = (await autenticado("select save_professional($1, null, 'Ana', true, $2) id", [loja, [corte]]))[0].id
  const semana = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, inicio_min: 540, fim_min: 1080 })))
  await autenticado("select save_working_hours($1, $2)", [ana, semana])

  // estado de produção em 2026-11-07
  await db.exec("drop table public.phone_blocklist")
  await db.exec(readFileSync(FIXTURE, "utf8"))
}, 180_000)

afterAll(async () => {
  await db.close()
  await referencia.close()
})

describe("A1: estado de produção reproduzido, antes do script", () => {
  it("a tabela phone_blocklist não existe", async () => {
    expect((await sql("select to_regclass('public.phone_blocklist') t"))[0].t).toBeNull()
  })

  it("PARAR falha porque process_whatsapp_reply usa a tabela ausente", async () => {
    await expect(
      svc("select process_whatsapp_reply('antes-1', now(), '5511911112222', null, 'PARAR')"),
    ).rejects.toThrow(/phone_blocklist/)
  })

  it("o claim_outbox de produção entrega acima do limite de 12 mensagens por número", async () => {
    await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [loja])
    for (let i = 0; i < 12; i++) await evento("11911113333", { status: "enviado" })
    const id = await evento("11911113333")
    expect(await reivindicar()).toContain(id)
    await sql("delete from outbox_events")
    await svc("select set_integration_status($1, 'whatsapp', 'nao_configurado')", [loja])
  })

  it("o catálogo difere do repositório só em phone_blocklist e claim_outbox", async () => {
    const [a, b] = [await catalogo(db), await catalogo(referencia)]
    const diferentes: string[] = []
    for (const grupo of Object.keys(a)) {
      for (const k of new Set([...Object.keys(a[grupo]), ...Object.keys(b[grupo])])) {
        if (JSON.stringify(a[grupo][k]) !== JSON.stringify(b[grupo][k])) diferentes.push(k)
      }
    }
    expect(diferentes.length).toBeGreaterThan(0)
    expect(diferentes.filter((k) => !k.includes("phone_blocklist") && !k.includes("claim_outbox"))).toEqual([])
  })
})

describe("A1: aplicação do script", () => {
  let linhasAntes: Record<string, any>[] = []

  it("não altera nenhuma linha já existente", async () => {
    await svc("select set_integration_status($1, 'whatsapp', 'nao_configurado')", [loja])
    await evento("11911114444")
    await evento("11911115555", { status: "bloqueado" })
    linhasAntes = await sql("select id, status, ultimo_erro, tentativas, atualizado_em from outbox_events order by id")

    await db.exec(readFileSync(SCRIPT, "utf8"))

    expect(await sql("select id, status, ultimo_erro, tentativas, atualizado_em from outbox_events order by id")).toEqual(linhasAntes)
    expect((await sql("select count(*)::int n from phone_blocklist"))[0].n).toBe(0)
    await sql("delete from outbox_events")
  })

  it("roda em uma única transação", () => {
    const texto = readFileSync(SCRIPT, "utf8")
    expect(texto).toMatch(/^[\s\S]*?\nbegin;\n[\s\S]*\ncommit;\s*$/)
  })

  it("não contém comando destrutivo nem escrita em dados", () => {
    const semComentarios = readFileSync(SCRIPT, "utf8").replace(/--.*$/gm, "")
    const foraDaFuncao = semComentarios.replace(/\$\$[\s\S]*?\$\$/g, "")
    // único alter permitido: ligar a RLS da tabela nova
    const semRls = foraDaFuncao.replace("alter table public.phone_blocklist enable row level security;", "")
    expect(semRls).not.toMatch(/\b(drop|truncate|delete|insert|update|alter)\b/i)
  })

  it("deixa o catálogo idêntico ao das migrations do repositório", async () => {
    expect(await catalogo(db)).toEqual(await catalogo(referencia))
  })

  it("pode ser reaplicado sem erro e sem mudar o catálogo nem os bloqueios", async () => {
    await sql("insert into phone_blocklist (telefone) values ('1999990000')")
    await db.exec(readFileSync(SCRIPT, "utf8"))
    expect((await sql("select telefone from phone_blocklist")).map((r) => r.telefone)).toEqual(["1999990000"])
    expect(await catalogo(db)).toEqual(await catalogo(referencia))
    await limpar()
  })
})

describe("A1: phone_blocklist depois do script", () => {
  it("nem anônimo nem autenticado leem ou gravam, mesmo com o privilégio padrão do Supabase", async () => {
    for (const papel of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const [r] = await sql("select has_table_privilege($1, 'public.phone_blocklist', $2) ok", [papel, priv])
        expect(r.ok, `${papel} ${priv}`).toBe(false)
      }
    }
    await expect(anonimo("select * from phone_blocklist")).rejects.toThrow(/permission denied/)
    await expect(autenticado("insert into phone_blocklist (telefone) values ('1100000000')")).rejects.toThrow(/permission denied/)
  })

  it("tem RLS ligada e aceita só 10 dígitos", async () => {
    expect((await sql("select relrowsecurity r from pg_class where oid = 'public.phone_blocklist'::regclass"))[0].r).toBe(true)
    await expect(sql("insert into phone_blocklist (telefone) values ('123')")).rejects.toThrow(/check/)
    await expect(sql("insert into phone_blocklist (telefone) values ('11912345678')")).rejects.toThrow(/check/)
  })
})

describe("A1: PARAR e claim_outbox depois do script", () => {
  beforeAll(async () => {
    await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [loja])
  })

  it("só service_role executa claim_outbox", async () => {
    const [r] = await sql(`select has_function_privilege('anon', 'public.claim_outbox(integer)', 'execute') anon,
      has_function_privilege('authenticated', 'public.claim_outbox(integer)', 'execute') auth,
      has_function_privilege('service_role', 'public.claim_outbox(integer)', 'execute') svc`)
    expect(r).toEqual({ anon: false, auth: false, svc: true })
    await expect(anonimo("select * from claim_outbox(1)")).rejects.toThrow(/permission denied/)
    await expect(autenticado("select * from claim_outbox(1)")).rejects.toThrow(/permission denied/)
  })

  it("PARAR de uma reserva real grava o bloqueio, registra o opt-out e cancela o aviso na fila", async () => {
    await limpar()
    const dia = (await anonimo("select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text d"))[0].d
    const [slot] = await anonimo("select slot_inicio from get_availability($1, $2, $3, $4) order by 1", [loja, corte, ana, dia])
    const reserva = (await autenticado(
      "select create_booking($1, $2, $3, $4, 'Cliente', '11912345678', true, true, null) id",
      [loja, corte, ana, slot.slot_inicio], ID.cli1,
    ))[0].id

    expect((await svc("select process_whatsapp_reply('parar-1', now(), '5511912345678', null, 'PARAR') r"))[0].r).toBe("processado")

    expect((await sql("select telefone from phone_blocklist")).map((r) => r.telefone)).toEqual(["1912345678"])
    expect((await sql("select marketing from customer_consents where profile_id = $1", [ID.cli1]))[0].marketing).toBe(false)
    expect((await sql("select tipo from consent_events where profile_id = $1 order by criado_em desc limit 1", [ID.cli1]))[0].tipo).toBe("opt_out")

    const entregues = await reivindicar()
    const [aviso] = await sql("select id, status, ultimo_erro from outbox_events where booking_id = $1 and tipo = 'reserva_criada'", [reserva])
    expect(entregues).not.toContain(aviso.id)
    expect(aviso).toMatchObject({ status: "cancelado", ultimo_erro: "numero_bloqueado" })
  })

  it("número bloqueado: cancela pendente e bloqueado, nos dois casos sem entregar", async () => {
    await limpar()
    await sql("insert into phone_blocklist (telefone) values ('1911116666')")
    const pendente = await evento("11911116666")
    const retido = await evento("11911116666", { status: "bloqueado" })
    const entregues = await reivindicar()
    expect(entregues).toEqual([])
    expect(await estado(pendente)).toEqual({ status: "cancelado", ultimo_erro: "numero_bloqueado" })
    expect(await estado(retido)).toEqual({ status: "cancelado", ultimo_erro: "numero_bloqueado" })
  })

  it("envio preso de número bloqueado não volta a sair", async () => {
    await limpar()
    await sql("insert into phone_blocklist (telefone) values ('1911117777')")
    const preso = await evento("11911117777", { status: "enviando", atualizado: new Date(Date.now() - 11 * 60_000).toISOString() })
    expect(await reivindicar()).toEqual([])
    expect(await estado(preso)).toEqual({ status: "cancelado", ultimo_erro: "numero_bloqueado" })
  })

  it("o bloqueio não afeta outro número", async () => {
    await limpar()
    await sql("insert into phone_blocklist (telefone) values ('1911118888')")
    const outro = await evento("11911119999")
    expect(await reivindicar()).toEqual([outro])
    expect((await estado(outro)).status).toBe("enviando")
  })

  it("o bloqueio não cancela evento do Google Calendar cujo destino contém os mesmos dígitos", async () => {
    await limpar()
    await svc("select set_integration_status($1, 'google_calendar', 'ativo')", [loja])
    await sql("insert into phone_blocklist (telefone) values ('1911110000')")
    const calendario = await evento("11911110000", { canal: "google_calendar" })
    expect(await reivindicar()).toEqual([calendario])
    await svc("select set_integration_status($1, 'google_calendar', 'nao_configurado')", [loja])
  })

  it("com 11 mensagens em 24h a 12ª sai; com 12, a 13ª é cancelada por limite_destino", async () => {
    await limpar()
    for (let i = 0; i < 11; i++) await evento("11922220000", { status: "enviado" })
    const decima2 = await evento("11922220000")
    expect(await reivindicar()).toEqual([decima2])
    await sql("update outbox_events set status = 'enviado' where id = $1", [decima2])

    const decima3 = await evento("11922220000")
    expect(await reivindicar()).toEqual([])
    expect(await estado(decima3)).toEqual({ status: "cancelado", ultimo_erro: "limite_destino" })
  })

  it("mensagens enviadas há mais de 24h não contam para o limite", async () => {
    await limpar()
    const ontem = new Date(Date.now() - 25 * 3_600_000).toISOString()
    for (let i = 0; i < 12; i++) await evento("11933330000", { status: "enviado", atualizado: ontem })
    const nova = await evento("11933330000")
    expect(await reivindicar()).toEqual([nova])
  })

  it("o limite não mistura números diferentes", async () => {
    await limpar()
    for (let i = 0; i < 12; i++) await evento("11944440000", { status: "enviado" })
    const outro = await evento("11955550000")
    expect(await reivindicar()).toEqual([outro])
  })

  it("regressão: sem canal ativo o evento fica bloqueado e nada é entregue", async () => {
    await limpar()
    await svc("select set_integration_status($1, 'whatsapp', 'nao_configurado')", [loja])
    const id = await evento("11966660000")
    expect(await reivindicar()).toEqual([])
    expect(await estado(id)).toEqual({ status: "bloqueado", ultimo_erro: "canal_nao_configurado" })
    await svc("select set_integration_status($1, 'whatsapp', 'ativo')", [loja])
  })

  it("regressão: envio preso de número livre volta à fila e soma uma tentativa", async () => {
    await limpar()
    const preso = await evento("11977770000", { status: "enviando", atualizado: new Date(Date.now() - 11 * 60_000).toISOString() })
    expect(await reivindicar()).toEqual([preso])
    expect((await sql("select status, tentativas from outbox_events where id = $1", [preso]))[0]).toEqual({ status: "enviando", tentativas: 1 })
  })
})
