/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
//
// Verificação estrutural de segurança das migrations 0001 a 0009 aplicadas em sequência (F12-01, F12-03; T13).
import { readdirSync, readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const db = new PGlite({ extensions: { btree_gist } })
const q = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    alter table storage.objects enable row level security;
  `)
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
  for (const f of files) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"))
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe("migrations em sequência", () => {
  it("as 51 migrations existem, numeradas sem lacunas, e aplicam sem erro", async () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
    expect(files.map((f) => f.slice(0, 4))).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025", "0026", "0027", "0028", "0029", "0030", "0031", "0032", "0033", "0034", "0035", "0036", "0037", "0038", "0039", "0040", "0041", "0042", "0043", "0044", "0045", "0046", "0047", "0048", "0049", "0050", "0051", "0052", "0053", "0054", "0055", "0056", "0057"])
  })

  it("supabase/aplicar/0005-0009.sql contém exatamente as migrations 0005 a 0009 (sem deriva)", () => {
    const aplicar = readFileSync("supabase/aplicar/0005-0009.sql", "utf8")
    for (const f of ["0005_financeiro", "0006_eventos", "0007_site", "0008_planos", "0009_calendario"]) {
      expect(aplicar, f).toContain(readFileSync(`supabase/migrations/${f}.sql`, "utf8").trim())
    }
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0023.sql contém exatamente a migration 0023 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0023.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0023_midia_s3.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0026.sql contém exatamente a migration 0026 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0026.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0026_resposta_whatsapp.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0027.sql contém exatamente a migration 0027 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0027.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0027_presenca_whatsapp.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0029.sql contém exatamente a migration 0029 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0029.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0029_despesas.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0030.sql contém exatamente a migration 0030 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0030.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0030_despesas_mes.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0031.sql contém exatamente a migration 0031 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0031.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0031_despesas_reversao.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0032.sql contém exatamente a migration 0032 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0032.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0032_slugs_painel.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("aplicar/diferenca-limite-equipe.sql traz a função de limite igual à 0008 (sem deriva), em uma transação", () => {
    const diff = readFileSync("supabase/aplicar/diferenca-limite-equipe.sql", "utf8")
    const fn = readFileSync("supabase/migrations/0008_planos.sql", "utf8").match(/create function private\.enforce_professional_limit\(\)[\s\S]*?\n\$\$;/)![0]
    expect(diff).toContain(fn.replace("create function", "create or replace function"))
    expect(diff).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0057.sql contém exatamente a migration 0057 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0057.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0057_saida_exclusao_equipe.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0056.sql contém exatamente a migration 0056 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0056.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0056_excluir_conta.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0055.sql contém exatamente a migration 0055 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0055.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0055_alerta_ponte.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0054.sql contém exatamente a migration 0054 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0054.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0054_alerta_seguranca.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0053.sql contém exatamente a migration 0053 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0053.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0053_slug_limite.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0052.sql contém exatamente a migration 0052 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0052.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0052_storage_envio_direto.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0051.sql contém exatamente a migration 0051 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0051.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0051_midia_limpeza_agendada.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0050.sql contém exatamente a migration 0050 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0050.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0050_midia_limpeza_reserva.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0049.sql contém exatamente a migration 0049 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0049.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0049_limite_reservas_equipe_ativa.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0048.sql contém exatamente a migration 0048 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0048.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0048_reserva_manual_sobrecarga_antiga.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0047.sql contém exatamente a migration 0047 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0047.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0047_agenda_vinculo_dono.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0046.sql contém exatamente a migration 0046 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0046.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0046_limite_respostas_por_barbearia.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0045.sql contém exatamente a migration 0045 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0045.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0045_reserva_manual_cota_fila_justa.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0044.sql contém exatamente a migration 0044 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0044.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0044_fila_teto_tentativas.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0043.sql contém exatamente a migration 0043 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0043.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0043_agenda_desvincular_conta.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0042.sql contém exatamente a migration 0042 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0042.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0042_estorno_repasse_atomico.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0041.sql contém exatamente a migration 0041 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0041.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0041_midia_cota.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0040.sql contém exatamente a migration 0040 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0040.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0040_slug_registro.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0039.sql contém exatamente a migration 0039 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0039.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0039_whatsapp_remetente_brasil.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0038.sql contém exatamente a migration 0038 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0038.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0038_desligamento_equipe.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0037.sql contém exatamente a migration 0037 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0037.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0037_convite_vinculo_email.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0036.sql contém exatamente a migration 0036 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0036.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0036_convite_renovar.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0035.sql contém exatamente a migration 0035 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0035.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0035_convite_email.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0034.sql contém exatamente a migration 0034 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0034.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0034_origem_conta_equipe.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0033.sql contém exatamente a migration 0033 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0033.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0033_convite_equipe.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0017.sql contém exatamente a migration 0017 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0017.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0017_reminder_config.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0019.sql contém exatamente a migration 0019 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0019.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0019_textos_mensagens.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("a diferença de reagendamento contém as funções atualizadas e pode ser reaplicada", async () => {
    const aplicar = readFileSync("supabase/aplicar/diferenca-reagendamento.sql", "utf8")
    const functions = (sql: string) => sql.match(/create (?:or replace )?function [\s\S]*?\n\$\$;/g) ?? []
    const migrations = ["0003_agenda", "0018_fila_whatsapp", "0020_retorno_cliente", "0021_limite_reservas", "0028_reagendamento_whatsapp"]
    const source = migrations.flatMap((file) => functions(readFileSync(`supabase/migrations/${file}.sql`, "utf8")))
      .map((definition) => definition.replace(/^create function /, "create or replace function "))
    const changed = functions(aplicar)
    expect(changed).toHaveLength(8)
    for (const definition of changed) expect(source).toContain(definition)
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
    await db.exec(aplicar)
  })

  it("supabase/aplicar/0022.sql contém exatamente a migration 0022 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0022.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0022_agendamento_manual.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0024.sql contém exatamente a migration 0024 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0024.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0024_credenciais_ia.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("supabase/aplicar/0025.sql contém exatamente a migration 0025 (sem deriva), em uma transação", () => {
    const aplicar = readFileSync("supabase/aplicar/0025.sql", "utf8")
    expect(aplicar).toContain(readFileSync("supabase/migrations/0025_instrucoes_assistente.sql", "utf8").trim())
    expect(aplicar).toMatch(/^[\s\S]*\nbegin;[\s\S]*commit;\s*$/)
  })

  it("a chave de IA da barbearia (0024) não tem nenhum acesso do navegador: só a Edge Function (service_role)", async () => {
    const acessos = await q(`select grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'ai_credentials' and grantee in ('anon', 'authenticated', 'PUBLIC')`)
    expect(acessos).toEqual([])
  })

  it("toda tabela do schema public tem RLS ligada", async () => {
    const sem = await q("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")
    expect(sem).toEqual([])
  })

  it("o papel authenticated só tem SELECT nas tabelas (escritas passam por funções)", async () => {
    const escritas = await q(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE')`)
    // DELETE direto existe só em serviços e profissionais, protegido por política de RLS da gestão (migration 0002)
    expect(escritas).toEqual(expect.arrayContaining([]))
    expect(escritas.every((e) => e.privilege_type === "DELETE" && ["services", "professionals"].includes(e.table_name))).toBe(true)
    const updates = await q(`select table_name, column_name from information_schema.column_privileges
      where table_schema = 'public' and grantee in ('authenticated', 'anon') and privilege_type = 'UPDATE' order by 1, 2`)
    // únicas colunas graváveis diretamente: dados cadastrais da barbearia e o próprio perfil (0001) e serviços, sob RLS da gestão (0002)
    expect(updates.map((u) => u.table_name)).toEqual(expect.arrayContaining([]))
    expect([...new Set(updates.map((u) => u.table_name))].sort()).toEqual(["barbershops", "profiles", "services"])
  })

  it("o anônimo não lê nenhuma tabela, exceto o catálogo de planos", async () => {
    const leitura = await q(`select distinct table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT'`)
    expect(leitura.map((r) => r.table_name)).toEqual(["plans"])
  })

  it("tabelas de segredo e de cobrança não têm nenhum privilégio para a API", async () => {
    const t = await q(`select distinct table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('authenticated', 'anon') and table_name in ('calendar_credentials', 'billing_events')`)
    expect(t).toEqual([])
  })

  it("toda função security definer fixa o search_path", async () => {
    const soltas = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef and not coalesce(p.proconfig::text ~ 'search_path', false)`)
    expect(soltas).toEqual([])
  })

  it("funções de servidor (worker, webhook, cobrança, tokens) só executam como service_role", async () => {
    const nomes = ["claim_outbox", "complete_outbox", "set_integration_status", "release_blocked_outbox", "schedule_reminders", "schedule_reactivation",
      "process_whatsapp_reply", "change_plan", "apply_billing_event", "complete_calendar_link", "store_calendar_tokens", "get_calendar_refresh_token",
      "get_calendar_target", "complete_calendar_sync"]
    for (const nome of nomes) {
      const [r] = await q(`select
        bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as auth,
        bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon,
        bool_or(has_function_privilege('service_role', p.oid, 'execute')) as svc
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${nome}'`)
      expect(r, nome).toEqual({ auth: false, anon: false, svc: true })
    }
  })

  it("nenhuma função pública fica executável por anônimo além das de leitura pública", async () => {
    const anon = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname not in ('handle_new_user')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`)
    expect(anon.map((r) => r.proname)).toEqual(["get_availability", "get_public_shop", "get_shop_login_photo", "get_slot_grid"])
  })

  it("o razão financeiro continua imutável depois de todas as migrations", async () => {
    await expect(db.exec("update public.financial_ledger set valor_centavos = 0")).resolves.toBeDefined() // sem linhas: não dispara
    const [t] = await q("select count(*)::int as n from pg_trigger where tgname = 'financial_ledger_immutable'")
    expect(t.n).toBe(1)
  })
})
