import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAIAgentsForReport } from '@/lib/dal';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reportId = request.nextUrl.searchParams.get('reportId');
  if (!reportId) {
    return NextResponse.json({ error: 'Missing reportId parameter' }, { status: 400 });
  }

  const agents = await getAIAgentsForReport({
    userId: session.user.id,
    role: session.user.role,
    reportId,
  });

  return NextResponse.json({
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      agentType: agent.agentType,
      responsesEndpoint: agent.responsesEndpoint,
      securityMode: agent.securityMode,
      migrationStatus: agent.migrationStatus,
      reportIds: agent.reportIds,
    })),
  }, { status: 200 });
}
