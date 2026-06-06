// Google Drive helpers (raw REST — no SDK dependency). Owner authorises once via
// OAuth; we store a refresh token and mint short-lived access tokens on demand.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

export function googleRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI || "https://www.ordoagency.com/api/google/callback";
}

export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",        // get a refresh token
    prompt: "consent",             // force refresh token on re-auth
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

// Exchange an authorization code for tokens (refresh + access + id).
export async function exchangeCode(code: string): Promise<{ refreshToken?: string; accessToken: string; email?: string }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "token exchange failed");
  let email: string | undefined;
  try {
    if (data.id_token) {
      const payload = JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64").toString());
      email = payload.email;
    }
  } catch { /* ignore */ }
  return { refreshToken: data.refresh_token, accessToken: data.access_token, email };
}

// Mint a fresh access token from the stored refresh token.
export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "refresh failed");
  return data.access_token as string;
}

export type DriveFile = { id: string; name: string; mimeType: string };

// List the direct children of a folder (folders + files), handling pagination.
export async function listChildren(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const res = await fetch(`${DRIVE}/files?${p.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "list failed");
    out.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

export const isFolder = (f: DriveFile) => f.mimeType === "application/vnd.google-apps.folder";
export const isGoogleDoc = (f: DriveFile) => f.mimeType === "application/vnd.google-apps.document";
export const isVideo = (f: DriveFile) => f.mimeType.startsWith("video/");

// Export a Google Doc as plain text.
export async function exportDocText(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(`${DRIVE}/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return "";
  return (await res.text()).replace(/\r/g, "").trim();
}

// Download a binary file's bytes (e.g. the edited video).
export async function downloadFile(accessToken: string, fileId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("download failed");
  const contentType = res.headers.get("content-type") || "video/mp4";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

// Parse a Drive folder id out of a pasted URL or raw id.
export function parseFolderId(input: string): string {
  const s = (input || "").trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : s;
}
