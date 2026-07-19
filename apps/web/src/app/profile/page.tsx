'use client';
import { useEffect, useState } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { Avatar, Button, Eyebrow, diceBearUrl, truncate } from '@/components/ui';
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
    'w-full px-3.5 py-2.5 rounded-xl bg-[#f6f4ee] text-sm focus:outline-none focus:ring-2 focus:ring-[#7d8cc4]/40';

  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-14">
      <AuthGate
        title="Sign in to view your profile"
        blurb="Your profile is tied to your wallet — display name and avatar are saved off-chain."
      >
        <div className="mb-6">
          <Eyebrow>Your profile</Eyebrow>
          <h1 className="font-display font-semibold text-4xl mt-3 leading-none">Profile</h1>
        </div>

        {/* Identity card */}
        <div className="rounded-[28px] shadow-sm p-8 flex flex-col items-center text-center" style={{ background: 'linear-gradient(160deg, #e4e9fb, #f3f0fb 55%, #e9e6f9)' }}>
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#7d8cc4] to-[#b7a8e0] p-[3px]">
            {address && (
              <Avatar key={address} seed={address} avatarUrl={profile?.avatarUrl} size={90} className="border-2 border-[#faf9f6]" />
            )}
          </div>
          <p className="font-display font-semibold text-lg mt-4">
            {profile?.displayName || profile?.email || 'Unnamed member'}
          </p>
          <div className="font-mono text-xs text-[#0b0b0e]/60 bg-white/60 rounded-full px-3 py-1 mt-2">
            {address ? truncate(address) : 'Resolving…'}
          </div>
        </div>

        {/* Settings */}
        <div className="rounded-2xl bg-white shadow-sm p-7 space-y-5 mt-6">
          <div>
            <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470] mb-2">
              Email
            </label>
            <div className="text-sm text-[#6b6470] px-3.5 py-2.5 rounded-xl bg-[#f6f4ee]">
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
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-mono tracking-[0.12em] uppercase text-[#6b6470]">
                Avatar URL
              </label>
              <button
                type="button"
                onClick={() => setAvatarUrl(diceBearUrl(`${address ?? 'bhishi'}-${Date.now()}`))}
                className="text-xs text-[#7d8cc4] hover:opacity-70"
              >
                Randomize
              </button>
            </div>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://… (leave blank for a generated avatar)"
              className={field}
            />
          </div>

          {error && (
            <p className="text-[#9a4a3a] text-sm bg-[#f3e3e0] rounded-xl px-3.5 py-2.5">
              Couldn’t load your profile: {error}
            </p>
          )}
          {saveErr && (
            <p className="text-[#9a4a3a] text-sm bg-[#f3e3e0] rounded-xl px-3.5 py-2.5">
              {saveErr}
            </p>
          )}
          {saved && !saveErr && (
            <p className="text-[#3a6d4a] text-sm bg-[#e6efe8] rounded-xl px-3.5 py-2.5">
              Saved.
            </p>
          )}

          <Button onClick={onSave} disabled={loading || !profile} full>
            {loading ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </AuthGate>
    </main>
  );
}
