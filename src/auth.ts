/**
 * auth.ts — Auth.js v5 (next-auth@beta) core configuration
 *
 * Located at project root so it can be imported by both API routes and middleware.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraId from 'next-auth/providers/microsoft-entra-id';
import bcrypt from 'bcryptjs';
import { USERS } from '@/config/users.config';

declare module 'next-auth' {
  interface User {
    role: string;
    reportIds: string[];
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: string;
      reportIds: string[];
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraId({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
    Credentials({
      name: 'Credentials',
      credentials: {
        username: { label: 'Usuario', type: 'text' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials) {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!username || !password) return null;

        const user = USERS.find((u) => u.username === username);
        if (!user) return null;

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          name: user.username,
          email: user.email,
          role: user.role,
          reportIds: user.reportIds,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'microsoft-entra-id') {
        const email = user.email?.toLowerCase();
        if (!email) return false;

        const configUser = USERS.find((u) => u.email?.toLowerCase() === email);
        if (!configUser) {
          // Reject user if not found in users.config.ts
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === 'microsoft-entra-id' && user?.email) {
        // Enforce user lookup again for JWT binding
        const configUser = USERS.find((u) => u.email?.toLowerCase() === user.email?.toLowerCase());
        if (configUser) {
          token.id = configUser.id;
          token.role = configUser.role;
          token.reportIds = configUser.reportIds;
        }
      } else if (user) {
        // Credentials provider
        token.id = user.id;
        token.role = user.role;
        token.reportIds = user.reportIds;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.reportIds = token.reportIds as string[];
      return session;
    },

  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
});
