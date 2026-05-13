import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';

// Root: route based on session presence. Middleware doesn't gate `/`
// because that would create a redirect loop for fresh visitors. We
// handle it explicitly here.
export default async function RootPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
  redirect('/login');
}
