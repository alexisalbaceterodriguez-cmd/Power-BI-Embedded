/**
 * auth.ts - Auth.js v5 hardened configuration.
 */
import NextAuth from 'next-auth';
import MicrosoftEntraId from 'next-auth/providers/microsoft-entra-id';
import {
  findUserByMicrosoftClaims,
  getSessionUserById,
  recordAuditEvent,
} from '@/lib/dal';

async function safeAuditEvent(params: {
  eventType: string;
  userId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await recordAuditEvent(params);
  } catch {
    // Auth flow must keep working even if audit persistence fails.
  }
}

declare module 'next-auth' {
  interface User {
    role: 'admin' | 'client';
    clientId?: string;
    reportIds: string[];
    rlsRoles?: string[];
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: 'admin' | 'client';
      clientId?: string;
      reportIds: string[];
      rlsRoles?: string[];
    };
  }
}

interface EnrichedToken {
  id?: string;
  role?: 'admin' | 'client';
  clientId?: string;
  reportIds?: string[];
  rlsRoles?: string[];
  name?: string | null;
  email?: string | null;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  accessTokenExpires?: number;
  [key: string]: unknown;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraId({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? process.env.AZURE_CLIENT_SECRET,
      issuer:
        process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ??
        (process.env.AZURE_TENANT_ID
          ? `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`
          : undefined),
      authorization: {
        params: {
          prompt: 'select_account',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'microsoft-entra-id') return false;

      const profileRecord = (profile ?? {}) as Record<string, unknown>;
      const claimCandidates = [
        user.email,
        typeof profileRecord.email === 'string' ? profileRecord.email : undefined,
        typeof profileRecord.preferred_username === 'string' ? profileRecord.preferred_username : undefined,
        typeof profileRecord.upn === 'string' ? profileRecord.upn : undefined,
        typeof profileRecord.unique_name === 'string' ? profileRecord.unique_name : undefined,
      ].filter((value): value is string => Boolean(value && value.trim()));

      console.log('[auth] signIn claimCandidates:', claimCandidates);

      if (claimCandidates.length === 0) {
        console.warn('[auth] signIn DENIED: no claim candidates extracted from profile', JSON.stringify(profileRecord));
        return false;
      }

      let mappedUser = null;
      try {
        mappedUser = await findUserByMicrosoftClaims(claimCandidates);
      } catch (err) {
        console.error('[auth] signIn DENIED: DB lookup failed', err);
        return false;
      }

      if (!mappedUser) {
        console.warn('[auth] signIn DENIED: no user found for claims', claimCandidates);
        await safeAuditEvent({
          eventType: 'auth.microsoft.denied',
          detail: { claimCandidates },
        });
        return false;
      }

      user.id = mappedUser.id;
      user.name = mappedUser.name ?? user.name;
      user.email = mappedUser.email ?? user.email;
      user.role = mappedUser.role;
      user.clientId = mappedUser.clientId;
      user.reportIds = mappedUser.reportIds;
      user.rlsRoles = mappedUser.rlsRoles;

      await safeAuditEvent({
        eventType: 'auth.microsoft.success',
        userId: mappedUser.id,
        detail: { claimCandidates },
      });
      return true;
    },
    async jwt({ token, user, account }) {
      const enriched = token as EnrichedToken;
      if (user) {
        enriched.id = user.id;
        enriched.role = user.role;
        enriched.clientId = user.clientId;
        enriched.reportIds = user.reportIds;
        enriched.rlsRoles = user.rlsRoles;
        token.name = user.name;
        token.email = user.email;
      }
      if (account) {
        enriched.accessToken = account.access_token;
        enriched.idToken = account.id_token;
        enriched.refreshToken = account.refresh_token;
        enriched.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : Date.now() + 3600_000;
      }

      if (enriched.id && !user) {
        try {
          const currentUser = await getSessionUserById(enriched.id);
          if (currentUser) {
            enriched.role = currentUser.role;
            enriched.clientId = currentUser.clientId;
            enriched.reportIds = currentUser.reportIds;
            enriched.rlsRoles = currentUser.rlsRoles;
            token.name = currentUser.name;
            token.email = currentUser.email;
          }
        } catch {
          // Keep existing token values to avoid breaking /api/auth/session JSON response.
        }
      }

      // Refresh the access token if it's expired (or about to expire in 5 min).
      if (enriched.accessTokenExpires && Date.now() > enriched.accessTokenExpires - 5 * 60_000) {
        if (enriched.refreshToken) {
          try {
            const tenantId = process.env.AZURE_TENANT_ID?.trim();
            const clientId = (process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? process.env.AZURE_CLIENT_ID)?.trim();
            const clientSecret = (process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? process.env.AZURE_CLIENT_SECRET)?.trim();
            if (tenantId && clientId && clientSecret) {
              const params = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'refresh_token',
                refresh_token: enriched.refreshToken,
                scope: 'openid profile email offline_access',
              });
              const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
              });
              if (resp.ok) {
                const data = (await resp.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
                if (data.access_token) {
                  enriched.accessToken = data.access_token;
                  enriched.accessTokenExpires = Date.now() + (data.expires_in ?? 3600) * 1000;
                  if (data.refresh_token) enriched.refreshToken = data.refresh_token;
                }
              }
            }
          } catch {
            // If refresh fails, keep stale token — OBO will fall back to SP token.
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      const enriched = token as EnrichedToken;
      if (!enriched.id || !enriched.role) {
        return session;
      }

      session.user.id = enriched.id;
      if (typeof token.name === 'string') {
        session.user.name = token.name;
      }
      if (typeof token.email === 'string') {
        session.user.email = token.email;
      }
      session.user.role = enriched.role;
      session.user.clientId = enriched.clientId;
      session.user.reportIds = enriched.reportIds ?? [];
      session.user.rlsRoles = enriched.rlsRoles;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60,
  },
  trustHost: true,
  useSecureCookies: process.env.NODE_ENV === 'production',
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
});
