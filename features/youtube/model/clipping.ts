// Shapes shared by the Clipping page and its routes.

export type ClipRow = {
  draftId: number;
  title: string;
  platform: string;
  inMs: number;
  outMs: number;
  stage: { name: string; color: string } | null;
  hasFinishedVideo: boolean;
};

export type ClipSource = {
  draftId: number;
  title: string;
  conceptId: number;
  conceptName: string | null;
  stage: { name: string; color: string } | null;
  videos: { url: string; label: string }[]; // the finished video first, then raw uploads
  hasFinishedVideo: boolean;
  updatedAt: string;
  clips: ClipRow[];
};

export function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  const mm = h ? String(m % 60).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
}
