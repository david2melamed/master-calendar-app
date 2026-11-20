"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppMark } from "@/components/ui/AppMark";
import { CalendarIcon, CheckSquareIcon, GearIcon } from "@/components/ui/icons";
import { SourceFilterList } from "@/components/calendar/SourceFilter";

const NAV = [
  { href: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { href: "/todo", label: "To-Do", Icon: CheckSquareIcon },
  { href: "/settings", label: "Settings", Icon: GearIcon },
] as const;

/**
 * App frame: a sidebar on wider screens (Mac), a bottom tab bar on phones.
 * Safe-area padding keeps content clear of the iPhone notch and home bar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(href + "/");

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <AppMark size={28} />
          <span className="text-[15px] font-semibold tracking-tight">Master Calendar</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150 ${
                active(href) ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              <Icon size={17} />
              {label}
            </Link>
          ))}
        </nav>
        {active("/calendar") && (
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-6">
            <SourceFilterList />
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        <nav
          aria-label="Main"
          className="flex shrink-0 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        >
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium transition-colors ${
                active(href) ? "text-accent" : "text-faint"
              }`}
            >
              <Icon size={22} />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
