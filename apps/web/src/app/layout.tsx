export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { Inter, Oswald, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/providers';
import { Navbar } from '@/components/Navbar';
import { ProfileSync } from '@/components/ProfileSync';
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const oswald = Oswald({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });
export const metadata: Metadata = { title: 'Bhishi — Save Together', description: 'Non-custodial ROSCA on Monad' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${inter.variable} ${oswald.variable} ${mono.variable}`}>
        <Providers>
          <ProfileSync />
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
