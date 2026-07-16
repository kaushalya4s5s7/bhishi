'use client';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

export function HeroCTAs() {
  const { login, authenticated } = usePrivy();
  const router = useRouter();

  const tryIt = async () => {
    if (!authenticated) await login();
    router.push('/dashboard');
  };

  const getEarlyAccess = async () => {
    if (!authenticated) await login();
    router.push('/early-access');
  };

  return (
    <div className="mt-9 flex flex-col sm:flex-row gap-4">
      <button
        type="button"
        onClick={tryIt}
        className="bg-[#0b0b0e] text-white font-semibold px-8 py-3.5 hover:bg-[#232127] transition text-center cursor-pointer"
      >
        Try it
      </button>
      <button
        type="button"
        onClick={getEarlyAccess}
        className="border border-black/15 text-[#0b0b0e] font-semibold px-8 py-3.5 hover:bg-black/5 transition text-center cursor-pointer"
      >
        Get early access
      </button>
    </div>
  );
}
