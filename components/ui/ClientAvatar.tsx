export default function ClientAvatar({ name, color, size = "md" }: { name: string; color: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const sizes = { sm: "w-6 h-6 text-[10px]", md: "w-8 h-8 text-xs", lg: "w-10 h-10 text-sm" };
  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 ring-1 ring-black/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_1px_2px_rgba(17,17,19,0.12)]`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}
