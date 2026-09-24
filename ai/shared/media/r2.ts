import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Server-side Cloudflare R2 upload (S3-compatible). Used to cache competitor reel
// thumbnails (Instagram CDN URLs expire within days, so we download + rehost them).
// Returns the public URL, or null if R2 isn't configured / the upload fails.

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.AI_R2_BUCKET;
const publicBase = (process.env.AI_R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");

let _client: S3Client | null = null;
function client(): S3Client | null {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _client;
}

export function r2Configured(): boolean {
  return !!(accountId && accessKeyId && secretAccessKey && bucket && publicBase);
}

// Is this URL already one of ours (i.e. already cached in R2)?
export function isR2Url(url?: string | null): boolean {
  return !!url && !!publicBase && url.startsWith(publicBase);
}

export async function uploadToR2(key: string, body: Uint8Array | Buffer, contentType: string): Promise<string | null> {
  const c = client();
  if (!c || !publicBase) return null;
  try {
    await c.send(new PutObjectCommand({ Bucket: bucket!, Key: key, Body: body, ContentType: contentType }));
    return `${publicBase}/${key}`;
  } catch {
    return null;
  }
}

// Delete an object from R2 given its public URL (the reverse of uploadToR2). Best-effort:
// returns true if we issued the delete, false if not ours / not configured / it failed.
export async function deleteFromR2(url?: string | null): Promise<boolean> {
  const c = client();
  if (!c || !publicBase || !url || !isR2Url(url)) return false;
  const key = decodeURIComponent(url.slice(publicBase.length + 1).split("?")[0]);
  if (!key) return false;
  try {
    await c.send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// Download an external image URL and rehost it to R2. Returns the new public URL, or
// null if anything fails (caller keeps the original URL as a fallback).
export async function cacheImageToR2(srcUrl: string, key: string): Promise<string | null> {
  if (!r2Configured() || !srcUrl) return null;
  try {
    // Instagram's media CDN (video especially) 403s plain server fetches — send a browser
    // User-Agent + Referer so downloads succeed.
    const res = await fetch(srcUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
        Accept: "*/*",
        Referer: "https://www.instagram.com/",
      },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    return await uploadToR2(key, buf, ct);
  } catch {
    return null;
  }
}
