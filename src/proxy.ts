/**
 * proxy.ts
 *
 * Protects all routes except /login and /api/auth/*.
 */
import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const isLoggedIn = Boolean(req.auth);
  const { pathname } = req.nextUrl;
  const isAsset = /\.(webp|png|jpg|svg)$/i.test(pathname);

  if (isAsset) {
    return NextResponse.next();
  }

  const isPublicPath = pathname.startsWith('/login') || pathname.startsWith('/api/auth');

  if (!isLoggedIn && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
