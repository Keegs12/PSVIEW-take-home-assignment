import { NextRequest, NextResponse } from 'next/server';
import { researchCompany } from '@/lib/agent';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { url, language } = (await req.json()) as { url: string; language?: string };
    if (!url || !/^https?:\/\/\S+$/i.test(url.trim())) {
      return NextResponse.json({ error: 'A valid http(s) URL is required' }, { status: 400 });
    }
    const { context, language: detected } = await researchCompany(url.trim(), language);
    return NextResponse.json({ context, language: detected });
  } catch (err) {
    console.error('[research]', err);
    // Surface a useful message (e.g. site blocked / unreachable) so the user can adjust.
    const msg = err instanceof Error ? err.message : 'Failed to research company';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
