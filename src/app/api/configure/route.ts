import { NextRequest, NextResponse } from 'next/server';
import { configureAgent } from '@/lib/agent';
import type { CompanyContext } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const context = (await req.json()) as CompanyContext;
    if (!context?.companyName || !context?.outreachGoal) {
      return NextResponse.json({ error: 'companyName and outreachGoal are required' }, { status: 400 });
    }
    const { persona, strategy } = await configureAgent(context);
    return NextResponse.json({ context, persona, strategy });
  } catch (err) {
    console.error('[configure]', err);
    return NextResponse.json({ error: 'Failed to configure agent' }, { status: 500 });
  }
}
