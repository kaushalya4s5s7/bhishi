'use client';
import { PrivyProvider } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
import { privyAppId, privyConfig } from '@/lib/privy';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const privyConfigAny = privyConfig as any;

const hasValidAppId = privyAppId && !privyAppId.startsWith('placeholder');

export function Providers({ children }: { children: React.ReactNode }) {
  if (!hasValidAppId) {
    return (
      <>
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-center text-sm py-2 px-4">
          ⚠️ Set <code className="bg-amber-600 px-1 rounded">NEXT_PUBLIC_PRIVY_APP_ID</code> in{' '}
          <code className="bg-amber-600 px-1 rounded">apps/web/.env.local</code> to enable wallet login
        </div>
        {children}
      </>
    );
  }
  // SmartWalletsProvider is always mounted, but it only does anything once
  // smart wallets are enabled in the Privy Dashboard (with a paymaster URL
  // registered there for gas sponsorship). Until then users keep their embedded
  // EOA and pay their own gas — see useMember(), which picks exactly one
  // identity either way.
  return (
    <PrivyProvider appId={privyAppId} config={privyConfigAny}>
      <SmartWalletsProvider>{children}</SmartWalletsProvider>
    </PrivyProvider>
  );
}
