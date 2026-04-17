import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getToken } from 'next-auth/jwt';
import { getAIAgentByIdForUser, getSecureReportConfigForUser, recordAuditEvent } from '@/lib/dal';
import { chatWithAgent } from '@/services/foundryAgents';
import { PowerBIServiceError } from '@/services/powerbi';

export const runtime = 'nodejs';

function normalizeForScopeCheck(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractCompanyIdsFromText(text: string): string[] {
  const normalized = normalizeForScopeCheck(text);
  const ids = new Set<string>();
  const regex = /(?:empresa|compania|compa.{0,2}ia)\s*(?:n(?:umero|ro)?\.?\s*)?0*(\d{1,3})/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalized)) !== null) {
    const value = String(Number(match[1]));
    if (value !== '0' && value !== 'NaN') {
      ids.add(value);
    }
  }

  return [...ids];
}

function extractAllowedCompanyIdsFromRoles(roles?: string[]): string[] {
  if (!roles || roles.length === 0) return [];

  const ids = new Set<string>();
  for (const role of roles) {
    const normalized = normalizeForScopeCheck(role);
    const regex = /empresa\s*0*(\d{1,3})/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
      const value = String(Number(match[1]));
      if (value !== '0' && value !== 'NaN') {
        ids.add(value);
      }
    }
  }

  return [...ids];
}

function getLatestUserMessage(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): string {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim());
  return latestUser?.content.trim() ?? '';
}

function listDisallowedCompanyIds(referencedCompanyIds: string[], allowedCompanyIds: string[]): string[] {
  const allowed = new Set(allowedCompanyIds);
  return referencedCompanyIds.filter((companyId) => !allowed.has(companyId));
}

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

  let userAccessToken: string | undefined;
  try {
    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (secret) {
      const jwtToken = await getToken({ req: request, secret });
      // Use the id_token for OBO — its audience is our client_id.
      // The access_token audience is graph.microsoft.com and fails OBO signature validation.
      userAccessToken = typeof jwtToken?.idToken === 'string' ? jwtToken.idToken : undefined;
    }
  } catch {
    // If JWT decoding fails, proceed without the user access token — OBO will be skipped.
  }

  try {
    const payload = (await request.json()) as {
      agentId?: string;
      reportId?: string;
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    };

    const agentId = payload.agentId?.trim();
    const requestedReportId = payload.reportId?.trim();
    if (!agentId) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: 'Missing messages' }, { status: 400 });
    }

    const latestUserMessage = getLatestUserMessage(messages);

    const agent = await getAIAgentByIdForUser({
      userId: session.user.id,
      role: session.user.role,
      agentId,
      reportId: requestedReportId,
    });

    if (!agent) {
      await recordAuditEvent({
        eventType: 'agent.chat.denied',
        userId: session.user.id,
        ip,
        detail: { agentId, reportId: requestedReportId },
      });

      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let effectiveUserName = session.user.email ?? session.user.name ?? session.user.id;
    let effectiveRlsRoles = session.user.rlsRoles;
    let allowedCompanyIds: string[] = [];

    if (agent.securityMode === 'rls-inherit') {
      if (!requestedReportId) {
        return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
      }

      const reportConfig = await getSecureReportConfigForUser({
        userId: session.user.id,
        role: session.user.role,
        requestedReportId,
      });

      if (!reportConfig) {
        await recordAuditEvent({
          eventType: 'agent.chat.rls_denied',
          userId: session.user.id,
          ip,
          detail: { agentId, reportId: requestedReportId, reason: 'report_access_denied' },
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const reportRlsRoles = reportConfig.rlsRoles && reportConfig.rlsRoles.length > 0 ? reportConfig.rlsRoles : undefined;

      if (session.user.role === 'admin') {
        const adminRlsRolesDefined = reportConfig.adminRlsRoles && reportConfig.adminRlsRoles.length > 0;
        const roleSource = adminRlsRolesDefined ? reportConfig.adminRlsRoles : reportRlsRoles;
        effectiveRlsRoles = roleSource && roleSource.length > 0 ? roleSource : undefined;
        if (effectiveRlsRoles && effectiveRlsRoles.length > 0) {
          effectiveUserName = reportConfig.adminRlsUsername ?? effectiveUserName;
        }
      } else if (reportRlsRoles && reportRlsRoles.length > 0) {
        const userRlsRoles = session.user.rlsRoles ?? [];
        const intersection = userRlsRoles.filter((role) => reportRlsRoles.includes(role));
        if (intersection.length === 0) {
          await recordAuditEvent({
            eventType: 'agent.chat.rls_denied',
            userId: session.user.id,
            ip,
            detail: { agentId, reportId: requestedReportId, reason: 'no_role_intersection' },
          });
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        effectiveRlsRoles = intersection;
      }

      allowedCompanyIds = extractAllowedCompanyIdsFromRoles(effectiveRlsRoles);
      if (allowedCompanyIds.length > 0 && latestUserMessage) {
        const referencedCompanyIds = extractCompanyIdsFromText(latestUserMessage);
        const disallowedCompanyIds = listDisallowedCompanyIds(referencedCompanyIds, allowedCompanyIds);
        if (disallowedCompanyIds.length > 0) {
          await recordAuditEvent({
            eventType: 'agent.chat.rls_denied',
            userId: session.user.id,
            ip,
            detail: {
              agentId,
              reportId: requestedReportId,
              reason: 'query_out_of_scope',
              referencedCompanyIds,
              allowedCompanyIds,
              disallowedCompanyIds,
            },
          });
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    const assistantText = await chatWithAgent({
      agentType: agent.agentType,
      responsesEndpoint: agent.responsesEndpoint,
      securityMode: agent.securityMode,
      userName: effectiveUserName,
      rlsRoles: effectiveRlsRoles,
      messages,
      userAccessToken,
    });

    if (agent.securityMode === 'rls-inherit' && allowedCompanyIds.length > 0) {
      const referencedCompanyIds = extractCompanyIdsFromText(assistantText);
      const disallowedCompanyIds = listDisallowedCompanyIds(referencedCompanyIds, allowedCompanyIds);
      if (disallowedCompanyIds.length > 0) {
        await recordAuditEvent({
          eventType: 'agent.chat.rls_denied',
          userId: session.user.id,
          ip,
          detail: {
            agentId,
            reportId: requestedReportId,
            reason: 'response_out_of_scope',
            referencedCompanyIds,
            allowedCompanyIds,
            disallowedCompanyIds,
          },
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await recordAuditEvent({
      eventType: 'agent.chat.success',
      userId: session.user.id,
      ip,
      detail: {
        agentId,
        reportId: requestedReportId,
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
