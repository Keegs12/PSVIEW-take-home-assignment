import { NextRequest, NextResponse } from 'next/server';
import { shapeHiringProfile } from '@/lib/agent';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { entries, context } = (await req.json()) as {
      entries: string[];
      context?: { companyName?: string; whatTheyDo?: string };
    };
    if (!Array.isArray(entries) || !entries.some((e) => (e || '').trim())) {
      return NextResponse.json({ error: 'Add at least one profile URL or pasted text' }, { status: 400 });
    }
    const result = await shapeHiringProfile(entries, context);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[profiles]', err);
    const msg = err instanceof Error ? err.message : 'Failed to synthesize hiring profile';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
