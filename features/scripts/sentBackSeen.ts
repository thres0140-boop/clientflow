// Tracks which "sent back" drafts a member has already opened, so the sidebar badge
// counts only the ones they haven't looked at yet and ticks down as they open each.
// Keyed per client; value maps draftId -> the rejectionFeedback text that was seen
// (so a fresh send-back with new feedback re-notifies).

function key(clientId: number) { return `cf_sentback_seen_${clientId}`; }

export function getSeen(clientId: number): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(key(clientId)) || "{}"); } catch { return {}; }
}

export function markSeen(clientId: number, draftId: number, feedback: string | null | undefined) {
  if (!feedback) return;
  const seen = getSeen(clientId);
  if (seen[draftId] === feedback) return;
  seen[draftId] = feedback;
  try { localStorage.setItem(key(clientId), JSON.stringify(seen)); } catch { /* ignore */ }
}

// Count drafts that are sent-back (have rejectionFeedback) and not yet seen with
// that exact feedback.
export function countUnseenSentBack(clientId: number, drafts: { id: number; rejectionFeedback?: string | null }[]): number {
  const seen = getSeen(clientId);
  return drafts.filter((d) => d.rejectionFeedback && seen[d.id] !== d.rejectionFeedback).length;
}
