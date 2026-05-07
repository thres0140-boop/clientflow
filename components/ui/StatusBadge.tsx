import { STATUSES } from "@/lib/types";

export default function StatusBadge({ status }: { status: string }) {
  const s = STATUSES.find((s) => s.value === status) ?? STATUSES[0];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}
