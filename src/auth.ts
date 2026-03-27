/**
 * auth.ts - Auth.js v5 hardened configuration.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraId from 'next-auth/providers/microsoft-entra-id';
import {
  authenticateLocalUser,
  findUserByMicrosoftClaims,
  getSessionUserById,
  recordAuditEvent,
  SessionAuthUser,
} from '@/lib/dal';

declare module 'next-auth' {
  interface User {
    role: 'admin' | 'client';
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
      reportIds: string[];
      rlsRoles?: string[];
    };
  }
}

function ipFromRequest(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? undefined;
}

function toAuthUser(user: SessionAuthUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    reportIds: user.reportIds,
    rlsRoles: user.rlsRoles,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraId({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      authorization: {
        params: {
          prompt: 'select_account',
        },
      },
    }),
    Credentials({
      name: 'Credentials',
      credentials: {
        username: { label: 'Usuario', type: 'text' },
        password: { label: 'Contrasena', type: 'password' },
      },
      async authorize(credentials, request) {
        const username = String(credentials?.username ?? '');
        const password = String(credentials?.password ?? '');
        const ip = ipFromRequest(request);

        const result = await authenticateLocalUser({
          username,
          password,
          ip,
        });

        if (result.status !== 'ok' || !result.user) {
          await recordAuditEvent({
            eventType: 'auth.local.failed',
            ip,
            detail: {
              username,
              reason: result.status,
              retryAfterSeconds: result.retryAfterSeconds,
            },
          });
          return null;
        }

        await recordAuditEvent({
          eventType: 'auth.local.success',
          userId: result.user.id,
          ip,
          detail: { username: result.user.name },
        });

        return toAuthUser(result.user);
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'microsoft-entra-id') {
        return true;
      }

      const profileRecord = (profile ?? {}) as Record<string, unknown>;
      const claimCandidates = [
        user.email,
        typeof profileRecord.email === 'string' ? profileRecord.email : undefined,
        typeof profileRecord.preferred_username === 'string' ? profileRecord.preferred_username : undefined,
        typeof profileRecord.upn === 'string' ? profileRecord.upn : undefined,
        typeof profileRecord.unique_name === 'string' ? profileRecord.unique_name : undefined,
      ].filter((value): value is string => Boolean(value && value.trim()));

      if (claimCandidates.length === 0) return false;

      const mappedUser = await findUserByMicrosoftClaims(claimCandidates);
      if (!mappedUser) {
        await recordAuditEvent({
          eventType: 'auth.microsoft.denied',
          detail: { claimCandidates },
        });
        return false;
      }

      user.id = mappedUser.id;
      user.role = mappedUser.role;
      user.reportIds = mappedUser.reportIds;
      user.rlsRoles = mappedUser.rlsRoles;

      await recordAuditEvent({
        eventType: 'auth.microsoft.success',
        userId: mappedUser.id,
        detail: { claimCandidates },
      });
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        (token as typeof token & { id?: string; role?: 'admin' | 'client'; reportIds?: string[]; rlsRoles?: string[] }).id = user.id;
        (token as typeof token & { id?: string; role?: 'admin' | 'client'; reportIds?: string[]; rlsRoles?: string[] }).role = user.role;
        (token as typeof token & { id?: string; role?: 'admin' | 'client'; reportIds?: string[]; rlsRoles?: string[] }).reportIds = user.reportIds;
        (token as typeof token & { id?: string; role?: 'admin' | 'client'; reportIds?: string[]; rlsRoles?: string[] }).rlsRoles = user.rlsRoles;
        return token;
      }

      const enrichedToken = token as typeof token & { id?: string; role?: 'admin' | 'client'; reportIds?: string[]; rlsRoles?: string[] };

      if (enrichedToken.id) {
        const currentUser = await getSessionUserById(enrichedToken.id);
        if (currentUser) {
          enrichedToken.role = currentUser.role;
          enrichedToken.reportIds = currentUser.reportIds;
          enrichedToken.rlsRoles = currentUser.rlsRoles;
        }
      }

      return token;
    },
    async session({ session, token }) {
      const enrichedToken = token as typeof token & { id?: string; role?: 'admin' | 'client'; reportIds?: string[]; rlsRoles?: string[] };
      if (!enrichedToken.id || !enrichedToken.role) {
        return session;
      }

      session.user.id = enrichedToken.id;
      session.user.role = enrichedToken.role;
      session.user.reportIds = enrichedToken.reportIds ?? [];
      session.user.rlsRoles = enrichedToken.rlsRoles;
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
