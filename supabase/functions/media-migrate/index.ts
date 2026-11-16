/**
 * Cópia única das fotos do Supabase Storage (bucket site-media) para o AWS S3. Só com o segredo MEDIA_MIGRATE_SECRET no cabeçalho
 * x-migrate-secret (mesmo padrão do outbox-worker; o Authorization leva a chave anon, exigida pelo gateway).
 *   POST { "acao": "simular" }        → lista o que falta copiar (nada muda);
 *   POST { "acao": "copiar" }         → baixa do Supabase, grava no S3 na pasta certa, confere o tamanho no S3 e só então troca o
 *                                       caminho no banco. O arquivo antigo CONTINUA no Supabase;
 *   POST { "acao": "apagar-antigas" } → só se nenhum registro apontar mais para o Supabase e todos os arquivos existirem no S3:
 *                                       apaga as fotos do bucket site-media. Os documentos privados (shop-documents) não mudam.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { safeEqual } from '../_shared/webhook.ts';
import { KIND_FOLDER, LEGACY_PANEL_FILES, MAX_IMAGE_BYTES, imageType, newKey } from '../_shared/image.ts';
import { deleteObject, headObject, putObject } from '../_shared/s3.ts';

const LEGACY_BUCKET = 'site-media';
const S3 = 'BARBEARIA/%';

type Item = {
  tipo: 'media_objects' | 'services' | 'service_photos' | 'professionals' | 'painel';
  id: string;
  barbearia: string;
  pasta: string;
  de: string;
  kind?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function must<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Tudo o que ainda está no Supabase: registros com caminho antigo e os arquivos fixos do painel sem registro. */
async function pendentes(db: SupabaseClient): Promise<Item[]> {
  const itens: Item[] = [];
  for (const m of await must<{ id: string; barbershop_id: string; kind: string; storage_path: string }>(
    db.from('media_objects').select('id, barbershop_id, kind, storage_path').not('storage_path', 'like', S3),
  )) itens.push({ tipo: 'media_objects', id: m.id, barbearia: m.barbershop_id, pasta: KIND_FOLDER[m.kind], de: m.storage_path });
  for (const s of await must<{ id: string; barbershop_id: string; imagem_path: string }>(
    db.from('services').select('id, barbershop_id, imagem_path').not('imagem_path', 'is', null).not('imagem_path', 'like', S3),
  )) itens.push({ tipo: 'services', id: s.id, barbearia: s.barbershop_id, pasta: `servicos/${s.id}`, de: s.imagem_path });
  for (const f of await must<{ id: string; barbershop_id: string; service_id: string; storage_path: string }>(
    db.from('service_photos').select('id, barbershop_id, service_id, storage_path').not('storage_path', 'like', S3),
  )) itens.push({ tipo: 'service_photos', id: f.id, barbearia: f.barbershop_id, pasta: `servicos/${f.service_id}`, de: f.storage_path });
  for (const p of await must<{ id: string; barbershop_id: string; avatar_path: string }>(
    db.from('professionals').select('id, barbershop_id, avatar_path').not('avatar_path', 'is', null).not('avatar_path', 'like', S3),
  )) itens.push({ tipo: 'professionals', id: p.id, barbearia: p.barbershop_id, pasta: `profissionais/${p.id}`, de: p.avatar_path });

  const registradas = new Set((await must<{ barbershop_id: string; kind: string }>(
    db.from('media_objects').select('barbershop_id, kind').in('kind', Object.values(LEGACY_PANEL_FILES)),
  )).map((r) => `${r.barbershop_id}:${r.kind}`));
  for (const shop of await must<{ id: string }>(db.from('barbershops').select('id'))) {
    const { data, error } = await db.storage.from(LEGACY_BUCKET).list(shop.id, { search: 'painel-' });
    if (error) throw error;
    for (const file of data ?? []) {
      const kind = LEGACY_PANEL_FILES[file.name];
      if (kind && !registradas.has(`${shop.id}:${kind}`)) {
        itens.push({ tipo: 'painel', id: `${shop.id}:${kind}`, barbearia: shop.id, pasta: KIND_FOLDER[kind], de: `${shop.id}/${file.name}`, kind });
      }
    }
  }
  return itens;
}

/** Copia um arquivo e só troca o caminho no banco depois de conferir o arquivo no S3; se o banco mudou, desfaz no S3. */
async function copiar(db: SupabaseClient, item: Item): Promise<string> {
  const { data: blob, error } = await db.storage.from(LEGACY_BUCKET).download(item.de);
  if (error || !blob) throw new Error(`não baixou do Supabase: ${item.de}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = imageType(bytes);
  if (!type || bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) throw new Error(`arquivo inválido: ${item.de}`);
  const key = newKey(item.barbearia, item.pasta, type.ext);
  await putObject(key, bytes, type.mime);
  if ((await headObject(key)) !== bytes.length) {
    await deleteObject(key);
    throw new Error(`conferência no S3 falhou: ${item.de}`);
  }
  // a troca só vale se o registro ainda aponta para o arquivo copiado (eq no caminho antigo)
  const { data: changed, error: dbError } =
    item.tipo === 'media_objects' ? await db.from('media_objects').update({ storage_path: key, mime: type.mime, tamanho_bytes: bytes.length }).eq('id', item.id).eq('storage_path', item.de).select('id')
    : item.tipo === 'services' ? await db.from('services').update({ imagem_path: key }).eq('id', item.id).eq('imagem_path', item.de).select('id')
    : item.tipo === 'service_photos' ? await db.from('service_photos').update({ storage_path: key }).eq('id', item.id).eq('storage_path', item.de).select('id')
    : item.tipo === 'professionals' ? await db.from('professionals').update({ avatar_path: key }).eq('id', item.id).eq('avatar_path', item.de).select('id')
    : await db.from('media_objects').insert({ barbershop_id: item.barbearia, kind: item.kind, storage_path: key, mime: type.mime, tamanho_bytes: bytes.length }).select('id');
  if (dbError || !changed?.length) {
    await deleteObject(key);
    throw dbError ?? new Error(`o registro mudou durante a cópia: ${item.de}`);
  }
  return key;
}

/** Todos os caminhos do S3 que o banco usa (para conferir antes de apagar o Supabase). */
async function caminhosS3(db: SupabaseClient): Promise<string[]> {
  const col = async (table: string, column: string) =>
    (await must<Record<string, string>>(db.from(table).select(column).like(column, S3))).map((r) => r[column]);
  return [
    ...(await col('media_objects', 'storage_path')), ...(await col('services', 'imagem_path')),
    ...(await col('service_photos', 'storage_path')), ...(await col('professionals', 'avatar_path')),
  ];
}

async function apagarAntigas(db: SupabaseClient): Promise<Response> {
  const restantes = await pendentes(db);
  if (restantes.length) return json({ error: 'ainda há fotos no Supabase: rode "copiar" antes', pendentes: restantes.length }, 409);
  const faltando: string[] = [];
  for (const key of await caminhosS3(db)) if ((await headObject(key)) === null) faltando.push(key);
  if (faltando.length) return json({ error: 'fotos registradas que não estão no S3: nada foi apagado', faltando }, 409);

  let apagados = 0;
  for (const shop of await must<{ id: string }>(db.from('barbershops').select('id'))) {
    for (let rodada = 0; rodada < 50; rodada++) {
      const { data, error } = await db.storage.from(LEGACY_BUCKET).list(shop.id, { limit: 100 });
      if (error) throw error;
      const names = (data ?? []).filter((f) => f.id).map((f) => `${shop.id}/${f.name}`); // só arquivos (pastas não têm id)
      if (!names.length) break;
      const removed = await db.storage.from(LEGACY_BUCKET).remove(names);
      if (removed.error) throw removed.error;
      apagados += removed.data?.length ?? 0;
      if (names.length < 100 || !removed.data?.length) break;
    }
  }
  return json({ ok: true, apagados });
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const secret = Deno.env.get('MEDIA_MIGRATE_SECRET') ?? '';
  if (!secret || !safeEqual(req.headers.get('x-migrate-secret') ?? '', secret)) return json({ error: 'forbidden' }, 403);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { acao = 'simular' } = ((await req.json().catch(() => ({}))) ?? {}) as { acao?: string };
  try {
    if (acao === 'simular') {
      const itens = await pendentes(db);
      return json({ pendentes: itens.length, itens: itens.map(({ tipo, de, pasta }) => ({ tipo, de, para: `BARBEARIA/<barbearia>/${pasta}/` })) });
    }
    if (acao === 'copiar') {
      const copiadas: { de: string; para: string }[] = [];
      const erros: { de: string; erro: string }[] = [];
      for (const item of await pendentes(db)) {
        try {
          copiadas.push({ de: item.de, para: await copiar(db, item) });
        } catch (err) {
          erros.push({ de: item.de, erro: err instanceof Error ? err.message : String(err) });
        }
      }
      return json({ copiadas: copiadas.length, erros, detalhes: copiadas }, erros.length ? 207 : 200);
    }
    if (acao === 'apagar-antigas') return await apagarAntigas(db);
    return json({ error: 'acao: simular | copiar | apagar-antigas' }, 400);
  } catch (err) {
    console.error('[media-migrate]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
