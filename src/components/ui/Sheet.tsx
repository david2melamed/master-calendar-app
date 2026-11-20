"use client";
import { Dialog } from "radix-ui";
import { XIcon } from "./icons";
import { useMediaQuery } from "@/hooks/useMedia";

/**
 * A panel that slides in from the right on wide screens and rises from the
 * bottom on phones. Accessible: focus is trapped, Esc / swipe-off / tap outside closes.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  side,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: React.ReactNode;
  side?: "right" | "bottom";
}) {
  const wide = useMediaQuery("(min-width: 768px)");
  const placement = side ?? (wide ? "right" : "bottom");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/20 data-[state=closed]:animate-[mc-fade-out_180ms_ease-in] data-[state=open]:animate-[mc-fade-in_200ms_ease-out] dark:bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className={
            placement === "right"
              ? "fixed inset-y-3 right-3 z-50 flex w-[420px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-lg outline-none data-[state=closed]:animate-[mc-slide-out-right_180ms_ease-in] data-[state=open]:animate-[mc-slide-in-right_220ms_cubic-bezier(0.2,0.8,0.2,1)]"
              : "fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] shadow-lg outline-none data-[state=closed]:animate-[mc-slide-down_180ms_ease-in] data-[state=open]:animate-[mc-slide-up_240ms_cubic-bezier(0.2,0.8,0.2,1)]"
          }
        >
          {placement === "bottom" && <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden />}
          <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-3">
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            <span />
            <Dialog.Close
              className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
              aria-label="Close"
            >
              <XIcon size={18} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
