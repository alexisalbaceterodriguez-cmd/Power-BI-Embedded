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

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraId({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? process.env.AZURE_CLIENT_ID ?? process.env.CLIENT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? process.env.AZURE_CLIENT_SECRET ?? process.env.CLIENT_SECRET,
      issuer:
        process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ??
        (process.env.AZURE_TENANT_ID || process.env.TENANT_ID
          ? `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID ?? process.env.TENANT_ID}/v2.0`
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
      user.name = mappedUser.name ?? user.name;
      user.email = mappedUser.email ?? user.email;
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
        token.name = user.name;
        token.email = user.email;
        return token;
      }

      const enrichedToken = token as typeof token & { id?: string; role?: 'admin' | 'client'; reportIds?: string[]; rlsRoles?: string[] };

      if (enrichedToken.id) {
        const currentUser = await getSessionUserById(enrichedToken.id);
        if (currentUser) {
          enrichedToken.role = currentUser.role;
          enrichedToken.reportIds = currentUser.reportIds;
          enrichedToken.rlsRoles = currentUser.rlsRoles;
          token.name = currentUser.name;
          token.email = currentUser.email;
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
      if (typeof token.name === 'string') {
        session.user.name = token.name;
      }
      if (typeof token.email === 'string') {
        session.user.email = token.email;
      }
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
