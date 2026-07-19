export const dynamic = 'force-dynamic';
import type { Metadata, Viewport } from 'next';
import { Inter, Oswald, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/providers';
import { Navbar } from '@/components/Navbar';
import { ProfileSync } from '@/components/ProfileSync';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const oswald = Oswald({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });
export const metadata: Metadata = {
  title: 'Bhishi — Save Together',
  description: 'Non-custodial ROSCA on Monad',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Bhishi' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#0b0b0e',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${inter.variable} ${oswald.variable} ${mono.variable}`}>
        <Providers>
          <ServiceWorkerRegister />
          <ProfileSync />
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
