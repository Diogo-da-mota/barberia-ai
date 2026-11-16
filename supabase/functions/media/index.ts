/**
 * Fotos das barbearias no AWS S3 (pasta BARBEARIA/<barbearia>/...). Só o proprietário ou o gerente da barbearia dona da pasta.
 *   POST multipart { barbearia, pasta, arquivo } → grava e devolve { key, size } (o banco registra depois e devolve a foto antiga);
 *   POST JSON { apagar: [key, ...] } → apaga (foto substituída ou removida; também desfaz um envio que o banco recusou).
 * O tipo é conferido pelo conteúdo do arquivo (JPEG, PNG ou WebP) e o tamanho máximo é 2 MB.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { AuthError, requireBarbershopManagement } from '../_shared/auth.ts';
import { MAX_IMAGE_BYTES, MEDIA_FOLDER_RE, UUID_RE, imageType, keyShop, newKey } from '../_shared/image.ts';
import { deleteObject, putObject } from '../_shared/s3.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      const shopId = String(form.get('barbearia') ?? '');
      const folder = String(form.get('pasta') ?? '');
      const file = form.get('arquivo');
      if (!UUID_RE.test(shopId) || !MEDIA_FOLDER_RE.test(folder) || !(file instanceof File)) return json({ error: 'invalid_media' }, 400);
      await requireBarbershopManagement(req, shopId);
      if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return json({ error: 'invalid_media' }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = imageType(bytes);
      if (!type) return json({ error: 'invalid_media' }, 400);
      const key = newKey(shopId, folder, type.ext);
      await putObject(key, bytes, type.mime);
      return json({ key, size: bytes.length });
    }

    const body = (await req.json().catch(() => null)) as { apagar?: unknown } | null;
    const keys = Array.isArray(body?.apagar) ? body.apagar.filter((k): k is string => typeof k === 'string') : [];
    const shops = new Set(keys.map(keyShop));
    if (keys.length === 0 || keys.length > 25 || shops.has(null)) return json({ error: 'invalid_media' }, 400);
    for (const shopId of shops) await requireBarbershopManagement(req, shopId!);
    await Promise.all(keys.map(deleteObject));
    return json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return json({ error: 'forbidden' }, err.status);
    console.error('[media]', err);
    return json({ error: 'media_failed' }, 500);
  }
});
