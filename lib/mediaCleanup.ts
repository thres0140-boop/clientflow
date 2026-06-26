import { createHash } from "crypto";
import { deleteFromR2, isR2Url } from "@/lib/r2";

// Once a post is confirmed LIVE on Instagram, its raw clips + finished cut are dead weight
// in our storage (Instagram hosts the final video now). This module deletes that media so
// Cloudinary/R2 don't fill up — which is what blew past the Cloudinary free limit before.

// Pull the public_id + resource_type out of a Cloudinary delivery URL, e.g.
//   https://res.cloudinary.com/<cloud>/video/upload/v1699/folder/abc.mp4
//   → { resourceType: "video", publicId: "folder/abc" }
function parseCloudinary(url: string): { resourceType: string; publicId: string } | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)cloudinary\.com$/.test(u.hostname) && !u.hostname.includes("res.cloudinary.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean); // [cloud, resourceType, "upload", ...rest]
    const upIdx = parts.indexOf("upload");
    if (upIdx === -1) return null;
    const resourceType = parts[upIdx - 1] || "image"; // "image" | "video" | "raw"
    let rest = parts.slice(upIdx + 1);
    // Drop transformation segments (anything before the version) and the version itself.
    const vIdx = rest.findIndex((p) => /^v\d+$/.test(p));
    if (vIdx !== -1) rest = rest.slice(vIdx + 1);
    if (!rest.length) return null;
    const last = rest[rest.length - 1].replace(/\.[a-z0-9]+$/i, ""); // strip extension
    const publicId = [...rest.slice(0, -1), last].join("/");
    return publicId ? { resourceType, publicId } : null;
  } catch {
    return null;
  }
}

function isCloudinaryUrl(url: string): boolean {
  return /cloudinary\.com/.test(url);
}

// Signed Cloudinary destroy. Needs CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET (secrets).
// Without them we skip gracefully — R2 deletes still work, Cloudinary just won't be purged.
async function deleteFromCloudinary(url: string): Promise<boolean> {
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !apiSecret) return false;
  const parsed = parseCloudinary(url);
  if (!parsed) return false;
  const timestamp = Math.floor(Date.now() / 1000);
  // signature = sha1("public_id=<id>&timestamp=<ts>" + api_secret)
  const signature = createHash("sha1")
    .update(`public_id=${parsed.publicId}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");
  const form = new URLSearchParams({
    public_id: parsed.publicId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature,
  });
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${parsed.resourceType}/destroy`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const j = await res.json().catch(() => ({}));
    return j?.result === "ok" || j?.result === "not found";
  } catch {
    return false;
  }
}

// Delete one media URL from whichever storage hosts it. Never throws.
export async function deleteMediaUrl(url?: string | null): Promise<boolean> {
  if (!url) return false;
  if (isR2Url(url)) return deleteFromR2(url);
  if (isCloudinaryUrl(url)) return deleteFromCloudinary(url);
  return false;
}

// Delete a batch (raw clips + finished cut) for a posted draft. Returns how many were
// actually removed. Logs what it couldn't touch so we can see if Cloudinary creds are missing.
export async function deletePostedMedia(urls: (string | null | undefined)[]): Promise<number> {
  const list = urls.filter((u): u is string => !!u);
  let deleted = 0;
  for (const u of list) {
    try {
      if (await deleteMediaUrl(u)) deleted++;
      else console.log("[media-cleanup] skipped (no creds / not ours):", u.slice(0, 80));
    } catch (e) {
      console.error("[media-cleanup] error deleting", u.slice(0, 80), e);
    }
  }
  return deleted;
}
