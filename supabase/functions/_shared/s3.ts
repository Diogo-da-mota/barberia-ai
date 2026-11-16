/**
 * S3 das fotos (bucket privado; leitura pelo CloudFront). A chave da AWS fica só nos segredos das Edge Functions:
 * AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (usuário IAM com acesso só a BARBEARIA/*).
 */
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const region = Deno.env.get('AWS_REGION') ?? 'sa-east-1';
const bucket = Deno.env.get('AWS_S3_BUCKET') ?? '';
const aws = new AwsClient({
  accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? '',
  region,
  service: 's3',
});
const url = (key: string) => `https://${bucket}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Nome único por envio: o CDN e o navegador podem guardar para sempre. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const res = await aws.fetch(url(key), { method: 'PUT', body, headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL } });
  if (!res.ok) throw new Error(`s3_put_${res.status}`);
}

export async function deleteObject(key: string): Promise<void> {
  const res = await aws.fetch(url(key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`s3_delete_${res.status}`);
}

/** Tamanho do arquivo no S3, ou null se não existe (sem permissão de listar, o S3 responde 403 para arquivo inexistente). */
export async function headObject(key: string): Promise<number | null> {
  const res = await aws.fetch(url(key), { method: 'HEAD' });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`s3_head_${res.status}`);
  return Number(res.headers.get('content-length'));
}
