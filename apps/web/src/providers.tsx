'use client';
import { PrivyProvider } from '@privy-io/react-auth';
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
  return (
    <PrivyProvider appId={privyAppId} config={privyConfigAny}>
      {children}
    </PrivyProvider>
  );
}
