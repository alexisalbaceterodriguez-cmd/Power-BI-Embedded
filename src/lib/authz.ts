import 'server-only';

import { auth } from '@/auth';

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return null;
  }
  return session;
}

export async function requireAdminSession() {
  const session = await requireSession();
  if (!session || session.user.role !== 'admin') {
    return null;
  }
  return session;
}
