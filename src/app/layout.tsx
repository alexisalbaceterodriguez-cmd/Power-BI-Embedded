import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import { SessionProvider } from 'next-auth/react';
import './globals.css';

// The Seidor brand uses Poppins Light and Semi Bold (300, 400, 600, 700)
const poppins = Poppins({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-poppins',
});

export const metadata: Metadata = {
  title: 'Seidor | Transformation & Technology',
  description: 'Human focused. Technology Experts. Portal de datos y transformación digital interactivo de Seidor.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${poppins.variable}`}>
      <body className={poppins.className}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
