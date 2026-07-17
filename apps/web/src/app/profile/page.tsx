'use client';
import { useEffect, useState } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { Button, Card, Eyebrow, truncate } from '@/components/ui';
import { useProfile } from '@/lib/profile';
import { useMember } from '@/lib/member';

export default function ProfilePage() {
  const { address } = useMember();
  const { profile, loading, error, save } = useProfile();

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  // Hydrate the form once the profile loads (and whenever it changes on save).
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName ?? '');
      setAvatarUrl(profile.avatarUrl ?? '');
    }
  }, [profile]);

  const onSave = async () => {
    setSaved(false);
    setSaveErr('');
    try {
      await save({ displayName: displayName.trim(), avatarUrl: avatarUrl.trim() });
      setSaved(true);
    } catch (e) {
      setSaveErr((e as Error).message);
    }
  };

  const field =
    'w-full px-3 py-2.5 border border-[#e6e2d9] rounded-sm bg-white text-sm focus:outline-none focus:border-[#c9a15c]';

  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-14 sm:py-20">
      <AuthGate
        title="Sign in to view your profile"
        blurb="Your profile is tied to your wallet — display name and avatar are saved off-chain."
      >
        <div className="mb-8">
          <Eyebrow>Your profile</Eyebrow>
          <h1 className="font-display font-semibold text-4xl mt-3 leading-none">Profile</h1>
        </div>

        <Card className="p-7 space-y-5">
          <div>
            <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">
              Wallet
            </label>
            <div className="font-mono text-sm text-[#0b0b0e] bg-[#f0ead8]/50 border border-[#e6e2d9] rounded-sm px-3 py-2.5">
              {address ? truncate(address) : 'Resolving…'}
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">
              Email
            </label>
            <div className="text-sm text-[#6b6470] px-3 py-2.5 border border-[#e6e2d9] rounded-sm bg-white">
              {profile?.email ?? '—'}
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">
              Display name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              placeholder="How others see you"
              className={field}
            />
          </div>

          <div>
            <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">
              Avatar URL
            </label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
              className={field}
            />
          </div>

          {error && (
            <p className="text-[#9a4a3a] text-sm bg-[#f3e3e0] border border-[#e8cfc9] rounded-sm px-3 py-2.5">
              Couldn’t load your profile: {error}
            </p>
          )}
          {saveErr && (
            <p className="text-[#9a4a3a] text-sm bg-[#f3e3e0] border border-[#e8cfc9] rounded-sm px-3 py-2.5">
              {saveErr}
            </p>
          )}
          {saved && !saveErr && (
            <p className="text-[#3a6d4a] text-sm bg-[#e6efe8] border border-[#cfe0d3] rounded-sm px-3 py-2.5">
              Saved.
            </p>
          )}

          <Button onClick={onSave} disabled={loading || !profile} full>
            {loading ? 'Saving…' : 'Save profile'}
          </Button>
        </Card>
      </AuthGate>
    </main>
  );
}
