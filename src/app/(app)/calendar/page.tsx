import { Suspense } from "react";
import { CalendarApp } from "@/components/calendar/CalendarApp";
import { CalendarSkeleton } from "@/components/calendar/CalendarSkeleton";

export const metadata = { title: "Calendar · Master Calendar" };

/** The calendar depends on "today", so it renders per visit (behind a skeleton). */
export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarSkeleton />}>
      <CalendarApp />
    </Suspense>
  );
}
