import { NextRequest, NextResponse } from 'next/server';
export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email || !String(email).includes('@')) return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  console.log('[waitlist]', email, new Date().toISOString());
  return NextResponse.json({ ok: true });
}
