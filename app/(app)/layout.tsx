import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

/** Every app destination shares the navigation shell; the public website at / does not. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
