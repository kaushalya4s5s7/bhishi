export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import { Inter, Oswald } from 'next/font/google';
import './globals.css';
import { Providers } from '@/providers';
import { Navbar } from '@/components/Navbar';
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const oswald = Oswald({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' });
export const metadata: Metadata = { title: 'Bhishi — Save Together', description: 'Non-custodial ROSCA on Monad' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${inter.variable} ${oswald.variable}`}>
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
