export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/providers';
const inter = Inter({ subsets: ['latin'] });
export const metadata: Metadata = { title: 'Bhishi — Save Together', description: 'Non-custodial ROSCA on Monad' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
