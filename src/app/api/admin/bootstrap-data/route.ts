import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { listReportsForAdmin, listUsersForAdmin } from '@/lib/dal';

export const runtime = 'nodejs';

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [users, reports] = await Promise.all([listUsersForAdmin(), listReportsForAdmin()]);
  return NextResponse.json({ users, reports }, { status: 200 });
}
