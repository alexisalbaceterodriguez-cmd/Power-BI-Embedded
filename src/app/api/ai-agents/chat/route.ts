import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAIAgentByIdForUser, recordAuditEvent } from '@/lib/dal';
import { chatWithFoundryAgent } from '@/services/foundryAgents';
import { PowerBIServiceError } from '@/services/powerbi';

export const runtime = 'nodejs';

function getClientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return request.headers.get('x-real-ip') ?? undefined;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = getClientIp(request);

  try {
    const payload = (await request.json()) as {
      agentId?: string;
      reportId?: string;
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    };

    const agentId = payload.agentId?.trim();
    if (!agentId) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: 'Missing messages' }, { status: 400 });
    }

    const agent = await getAIAgentByIdForUser({
      userId: session.user.id,
      role: session.user.role,
      agentId,
      reportId: payload.reportId?.trim(),
    });

    if (!agent) {
      await recordAuditEvent({
        eventType: 'agent.chat.denied',
        userId: session.user.id,
        ip,
        detail: { agentId, reportId: payload.reportId },
      });

      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const assistantText = await chatWithFoundryAgent({
      responsesEndpoint: agent.responsesEndpoint,
      securityMode: agent.securityMode,
      userName: session.user.email ?? session.user.name ?? session.user.id,
      rlsRoles: session.user.rlsRoles,
      messages,
    });

    await recordAuditEvent({
      eventType: 'agent.chat.success',
      userId: session.user.id,
      ip,
      detail: {
        agentId,
        reportId: payload.reportId,
        endpoint: agent.responsesEndpoint,
        securityMode: agent.securityMode,
      },
    });

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: assistantText,
      },
    });
  } catch (error) {
    if (error instanceof PowerBIServiceError) {
      await recordAuditEvent({
        eventType: 'agent.chat.failed',
        userId: session.user.id,
        ip,
        detail: {
          statusCode: error.statusCode,
          publicMessage: error.publicMessage,
          internalMessage: error.message,
        },
      });
      return NextResponse.json({
        error: error.publicMessage,
        code: 'AGENT_CHAT_FAILED',
      }, { status: error.statusCode });
    }

    await recordAuditEvent({
      eventType: 'agent.chat.failed',
      userId: session.user.id,
      ip,
      detail: {
        statusCode: 500,
        publicMessage: 'Internal Server Error',
        internalMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
