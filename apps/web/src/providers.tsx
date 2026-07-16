'use client';
import { PrivyProvider } from '@privy-io/react-auth';
import { privyAppId, privyConfig } from '@/lib/privy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const privyConfigAny = privyConfig as any;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider appId={privyAppId} config={privyConfigAny}>
      {children}
    </PrivyProvider>
  );
}
