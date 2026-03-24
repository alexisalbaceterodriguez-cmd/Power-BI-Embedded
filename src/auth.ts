/**
 * auth.ts — Auth.js v5 (next-auth@beta) core configuration
 *
 * Located at project root so it can be imported by both API routes and middleware.
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
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
          role: user.role,
          reportIds: user.reportIds,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.reportIds = user.reportIds;
      }
      return token;
    },
    async session({ session, token }) {
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
