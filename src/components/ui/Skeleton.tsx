/** Shimmering placeholder shown while content loads (we never use spinners). */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-surface-2 before:absolute before:inset-0 before:-translate-x-full before:animate-[mc-shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent dark:before:via-white/5 ${className}`}
    />
  );
}
