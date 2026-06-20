import { NextRequest, NextResponse } from 'next/server';
import { buildSequence } from '@/lib/agent';
import type { CompanyContext, Persona, OutreachStrategy } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { context, persona, strategy } = (await req.json()) as {
      context: CompanyContext;
      persona: Persona;
      strategy: OutreachStrategy;
    };
    if (!context || !persona || !strategy) {
      return NextResponse.json({ error: 'context, persona and strategy are required' }, { status: 400 });
    }
    const messages = await buildSequence(context, persona, strategy);
    return NextResponse.json({ messages });
  } catch (err) {
    console.error('[sequence]', err);
    return NextResponse.json({ error: 'Failed to build sequence' }, { status: 500 });
  }
}
