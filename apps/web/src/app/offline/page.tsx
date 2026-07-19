export default function OfflinePage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center bg-[#faf9f6] px-6 text-center">
      <div className="max-w-sm">
        <h1 className="font-display font-semibold text-2xl text-[#0b0b0e] mb-3">You&apos;re offline</h1>
        <p className="text-[#6b6470]">Bhishi needs a connection to read your circles and send transactions. Reconnect and try again.</p>
      </div>
    </main>
  );
}
