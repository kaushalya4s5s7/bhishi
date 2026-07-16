import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, name, whatsapp, tradition, circleSize, trackingMethod, role } = body;

  if (!email || !String(email).includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  console.log('[waitlist]', {
    email,
    name: name ?? null,
    whatsapp: whatsapp ?? null,
    tradition: tradition ?? null,
    circleSize: circleSize ?? null,
    trackingMethod: trackingMethod ?? null,
    role: role ?? null,
    at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
