import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth/current-user';
import { AppShell } from '@/components/app-shell';

// All authenticated pages share this shell. Pages render their own
// PageHeader inside main content; the AppShell handles chrome only
// (sidebar nav, user menu, topbar status).
export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
