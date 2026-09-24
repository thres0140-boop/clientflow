// Pure helpers for splitting/joining Concept.scriptExamples — NO server deps, so this
// is safe to import from client components as well as API routes.
//
// Examples are stored in one string. We separate them with an explicit sentinel so a
// single script that CONTAINS blank lines isn't fragmented into many "examples".
// Legacy data (joined by blank lines) falls back to the old blank-line split.
export const EXAMPLE_SEP = "\n\n⟢⟢⟢\n\n";
const SENTINEL = "⟢⟢⟢";

export function splitExamples(raw?: string | null): string[] {
  const s = raw || "";
  if (!s.trim()) return [];
  if (s.includes(SENTINEL)) {
    return s.split(new RegExp(`\\n*${SENTINEL}\\n*`)).map((x) => x.trim()).filter(Boolean);
  }
  return s.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
}

export function joinExamples(list: string[]): string {
  return list.map((x) => x.trim()).filter(Boolean).join(EXAMPLE_SEP);
}
