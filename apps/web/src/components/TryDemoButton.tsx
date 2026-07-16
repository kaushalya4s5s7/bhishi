'use client';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
export function TryDemoButton() {
  const { login, authenticated } = usePrivy();
  const router = useRouter();
  const handleClick = async () => {
    if (!authenticated) await login();
    router.push('/demo');
  };
  return (
    <button onClick={handleClick} className="px-8 py-4 bg-purple-600 text-white rounded-lg text-lg font-semibold hover:bg-purple-700 transition">
      Try Demo Circle
    </button>
  );
}
