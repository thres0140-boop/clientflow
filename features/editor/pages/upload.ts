// Browser → R2 multipart upload for b-roll files, the same /api/r2/multipart flow the Kanban's
// raw-content upload uses (8 MB parts, per-part retry, MD5 ETags so no response header has to
// be exposed through CORS). Kept here rather than imported because the Kanban's copy is a
// module-private function in a file other sessions are editing.
import SparkMD5 from "spark-md5";

const PART = 8 * 1024 * 1024;

function putPart(url: string, blob: Blob, onLoaded: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`part upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(blob);
  });
}

async function putPartWithRetry(url: string, blob: Blob, onLoaded: (n: number) => void, tries = 3): Promise<void> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { await putPart(url, blob, onLoaded); return; } catch (e) { last = e; await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function uploadToR2(file: File, onProgress: (pct: number) => void): Promise<string> {
  const total = file.size;
  const partCount = Math.max(1, Math.ceil(total / PART));
  const mp = async (payload: object) => fetch("/api/r2/multipart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());
  const create = await mp({ action: "create", filename: file.name, contentType: file.type || "video/mp4" });
  if (!create?.uploadId || !create?.key || !create?.publicUrl) throw new Error("Upload could not start: " + (create?.error || "storage not configured"));
  const { uploadId, key, publicUrl } = create;
  const parts: { PartNumber: number; ETag: string }[] = [];
  let uploadedBytes = 0;
  try {
    for (let i = 0; i < partCount; i++) {
      const start = i * PART, end = Math.min(start + PART, total);
      const blob = file.slice(start, end);
      const etag = '"' + SparkMD5.ArrayBuffer.hash(await blob.arrayBuffer()) + '"';
      const signed = await mp({ action: "sign", key, uploadId, partNumber: i + 1 });
      if (!signed?.url) throw new Error("could not sign part " + (i + 1));
      await putPartWithRetry(signed.url, blob, (loaded) => onProgress(Math.min(99, Math.round(((uploadedBytes + loaded) / total) * 100))));
      uploadedBytes += end - start;
      parts.push({ PartNumber: i + 1, ETag: etag });
    }
    const done = await mp({ action: "complete", key, uploadId, parts });
    if (!done?.publicUrl) throw new Error(done?.error || "could not finalize upload");
    onProgress(100);
    return done.publicUrl || publicUrl;
  } catch (e) {
    mp({ action: "abort", key, uploadId }).catch(() => {});
    throw e instanceof Error ? e : new Error(String(e));
  }
}
