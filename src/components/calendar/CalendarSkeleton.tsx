import { Skeleton } from "@/components/ui/Skeleton";

/** Placeholder shown while the calendar loads (never a spinner). */
export function CalendarSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-label="Loading calendar">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="hidden h-9 w-72 rounded-xl sm:block" />
      </div>
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-1 gap-3">
        <div className="flex w-12 flex-col gap-12 pt-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-3 w-8" />
          ))}
        </div>
        <div className="relative flex-1">
          <Skeleton className="absolute left-0 right-1/2 top-[8%] h-16" />
          <Skeleton className="absolute left-[52%] right-0 top-[12%] h-24" />
          <Skeleton className="absolute left-0 right-0 top-[38%] h-12" />
          <Skeleton className="absolute left-0 right-1/3 top-[60%] h-20" />
        </div>
      </div>
    </div>
  );
}
