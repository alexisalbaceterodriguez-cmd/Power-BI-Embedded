import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAccessibleReportsForUser } from '@/lib/dal';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reports = await getAccessibleReportsForUser(session.user.id, session.user.role);
  return NextResponse.json(
    { reports },
    {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=120',
      },
    }
  );
}
