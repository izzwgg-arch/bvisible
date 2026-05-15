'use server';

import { cookies } from 'next/headers';

const COOKIE = 'bv_onboarding_dismissed';

export async function dismissOnboardingChecklistAction(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, '1', {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
  });
}

export async function isOnboardingChecklistDismissed(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value === '1';
}
