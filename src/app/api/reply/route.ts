import { NextRequest, NextResponse } from 'next/server';
import { handleCandidateReply } from '@/lib/agent';
import type { CompanyContext, Persona, OutreachStrategy, ConversationTurn } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { context, persona, strategy, history, candidateMessage } = (await req.json()) as {
      context: CompanyContext;
      persona: Persona;
      strategy: OutreachStrategy;
      history: ConversationTurn[];
      candidateMessage: string;
    };
    if (!candidateMessage?.trim()) {
      return NextResponse.json({ error: 'candidateMessage is required' }, { status: 400 });
    }
    const { message, decision } = await handleCandidateReply({
      context,
      persona,
      strategy,
      history: history ?? [],
      candidateMessage,
    });
    return NextResponse.json({ message, decision });
  } catch (err) {
    console.error('[reply]', err);
    return NextResponse.json({ error: 'Failed to handle reply' }, { status: 500 });
  }
}
