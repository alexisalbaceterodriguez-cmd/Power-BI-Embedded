import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/authz';
import { listAIAgentsForAdmin, listClientsForAdmin, listReportsForAdmin, listUsersForAdmin } from '@/lib/dal';

export const runtime = 'nodejs';

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [users, reports, agents, clients] = await Promise.all([
    listUsersForAdmin(),
    listReportsForAdmin(),
    listAIAgentsForAdmin(),
    listClientsForAdmin(),
  ]);
  return NextResponse.json({ users, reports, agents, clients }, { status: 200 });
}
