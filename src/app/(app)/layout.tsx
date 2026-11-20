import { QueryProvider } from "@/components/providers/QueryProvider";
import { AppShell } from "@/components/shell/AppShell";

/** Every signed-in page shares the sidebar / tab bar frame. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <QueryProvider>
      <AppShell>{children}</AppShell>
    </QueryProvider>
  );
}
