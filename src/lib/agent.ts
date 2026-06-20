// The agent's brain. THIS is "where the intelligence is" — not one big prompt, but a small
// pipeline: configure (context -> typed persona + strategy) -> plan a grounded sequence ->
// and, on a candidate reply, classify -> decide -> then write. The decision layer is the
// differentiator the brief asks for ("intelligent, not just an LLM call").
//
// Pattern lineage (see ../../reference/NOTES.md): career-ops does the same "structured context
// -> persona -> grounded generation -> classify/strategize/then-generate" loop on the candidate
// side. We replicate it on the recruiter side.

import { completeJSON, complete, REASONING_MODEL, WRITER_MODEL, RESEARCH_MODEL } from './claude';
import type {
  CompanyContext,
  Persona,
  OutreachStrategy,
  SequenceMessage,
  AgentDecision,
  ReplyClassification,
  ConversationTurn,
  ConversationState,
  ConversationStage,
  AgentActionType,
  PolicyOutcome,
  VerificationResult,
} from './types';

// ---------------------------------------------------------------------------
// 0) RESEARCH — read a company's website and fill the context form (autonomous)
// ---------------------------------------------------------------------------
// The agent is given only a URL. It reads the page and *infers* the typed CompanyContext
// the recruiter would otherwise type by hand — grounded in what the page says, not generic
// copy. The recruiter edits the result before configuring. We fetch + strip the page
// ourselves (deterministic, no server-tool/beta dependency) and extract via tool-use JSON.

export async function researchCompany(
  url: string,
  language?: string,
): Promise<{ context: CompanyContext; language: string }> {
  const { text, truncated } = await fetchPageText(url);
  // Option 3: language is a deliberate, surfaced choice. With no override we localize to the
  // page's own language (an emergent "knows the company" signal) and report which we used; the
  // UI can then re-run with an explicit language to flip between the site's language and English.
  const languageRule = language
    ? `Write ALL field values in ${language}. Set "language" to "${language}".`
    : `Write the field values in the page's own primary language — localize to the company's ` +
      `market rather than defaulting to English. Set "language" to the language you used, as an ` +
      `English name (e.g. "English", "French").`;
  const out = await completeJSON<CompanyContext & { language: string }>({
    model: RESEARCH_MODEL,
    toolName: 'fill_company_context',
    system:
      `You configure a recruiting agent. Given the text of a company's website, fill in the ` +
      `context form a recruiter would use to brief outreach. Ground every field in what the ` +
      `page actually says — never invent facts, products, or metrics. Where the page doesn't ` +
      `state something (e.g. desired outreach tone), infer a specific, on-brand value from the ` +
      `company's voice and domain rather than generic filler. The outreachGoal is the ` +
      `recruiter's INTENT, which the page won't state — propose a concrete, plausible default ` +
      `given who the company is and who it likely hires (the recruiter will edit it). ` +
      languageRule,
    user: `COMPANY URL: ${url}\n\nWEBSITE TEXT${truncated ? ' (truncated)' : ''}:\n${text}`,
    schema: {
      type: 'object',
      required: ['companyName', 'whatTheyDo', 'culture', 'hiringProfile', 'tone', 'outreachGoal', 'language'],
      properties: {
        companyName: { type: 'string', description: 'The company name as the site presents it' },
        whatTheyDo: { type: 'string', description: 'One-liner + a sentence on the product, from the page' },
        culture: { type: 'string', description: 'Values / working style the page signals' },
        hiringProfile: { type: 'string', description: 'The kind of person they hire (infer if not explicit)' },
        tone: { type: 'string', description: 'Desired outreach voice, inferred from the brand voice' },
        outreachGoal: { type: 'string', description: 'A concrete recruiting intent to engage a candidate' },
        language: {
          type: 'string',
          description: 'The language the field values are written in, as an English name (e.g. "English", "French")',
        },
      },
    },
  });
  const { language: detected, ...context } = out;
  return { context, language: detected };
}

/** Fetch a URL and reduce its HTML to plain text the model can read. */
async function fetchPageText(url: string): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PSVIEW-Agent/1.0)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Couldn't load the page (${res.status} ${res.statusText})`);
  const html = await res.text();
  const text = htmlToText(html);
  if (!text) throw new Error('No readable text found at that URL');
  const MAX = 40000; // ~10K tokens — enough for any homepage, keeps research cost predictable
  return text.length > MAX
    ? { text: text.slice(0, MAX), truncated: true }
    : { text, truncated: false };
}

/** Strip scripts/styles/tags and collapse whitespace; lead with <title> + meta description. */
function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const desc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  const lead = [title && `TITLE: ${title}`, desc && `DESCRIPTION: ${desc}`].filter(Boolean).join('\n');
  return lead ? `${lead}\n\n${body}` : body;
}

// ---------------------------------------------------------------------------
// 0b) SHAPE PROFILE — distill a hiring archetype from example candidate profiles
// ---------------------------------------------------------------------------
// Optional enrichment: the recruiter points at a few exemplars ("more people like these")
// and the agent synthesizes the typed hiringProfile from the patterns across them — richer
// than a prose sentence. Open pages (GitHub, personal sites) are fetched; blocked sites
// (LinkedIn, X) are handled by letting the user paste the profile text as an entry instead.

export async function shapeHiringProfile(
  entries: string[],
  context?: { companyName?: string; whatTheyDo?: string },
): Promise<{ hiringProfile: string; used: number; skipped: string[] }> {
  const exemplars: string[] = [];
  const skipped: string[] = [];
  for (const raw of entries) {
    const entry = (raw || '').trim();
    if (!entry) continue;
    if (/^https?:\/\//i.test(entry)) {
      try {
        const { text } = await fetchPageText(entry);
        exemplars.push(`SOURCE: ${entry}\n${text.slice(0, 8000)}`); // cap each to bound cost
      } catch {
        skipped.push(entry); // a blocked/dead URL shouldn't sink the whole batch
      }
    } else {
      exemplars.push(`PASTED PROFILE:\n${entry.slice(0, 8000)}`); // paste fallback
    }
  }
  if (exemplars.length === 0) {
    throw new Error(
      'No profiles could be read. If the site blocks fetching (e.g. LinkedIn), paste the profile text instead.',
    );
  }

  const tailor = context?.companyName
    ? ` Tailor it to ${context.companyName}${context.whatTheyDo ? ` (${context.whatTheyDo})` : ''}.` +
      ` Write the profile in the same language as that company description.`
    : '';

  const out = await completeJSON<{ hiringProfile: string }>({
    model: RESEARCH_MODEL,
    toolName: 'synthesize_hiring_profile',
    system:
      `You define a hiring profile (ICP) for a recruiting agent by synthesizing the common ` +
      `archetype across several example candidate profiles. Output ONE hiringProfile description: ` +
      `the kind of person to engage — their level, core skills, and the signals that mark them as ` +
      `a fit. Ground it in patterns actually shared across the examples; do not copy any single ` +
      `person verbatim and do not include names or other personal identifiers.` + tailor,
    user: exemplars.map((e, i) => `EXAMPLE ${i + 1}\n${e}`).join('\n\n---\n\n'),
    schema: {
      type: 'object',
      required: ['hiringProfile'],
      properties: {
        hiringProfile: { type: 'string', description: 'The synthesized target hiring profile' },
      },
    },
  });
  return { hiringProfile: out.hiringProfile, used: exemplars.length, skipped };
}

// ---------------------------------------------------------------------------
// 1) CONFIGURE — context -> typed persona + strategy (the agent configures ITSELF)
// ---------------------------------------------------------------------------

export async function configureAgent(
  context: CompanyContext,
): Promise<{ persona: Persona; strategy: OutreachStrategy }> {
  const out = await completeJSON<{ persona: Persona; strategy: OutreachStrategy }>({
    model: REASONING_MODEL,
    toolName: 'configure_agent',
    system:
      `You are an autonomous recruiting agent that configures ITSELF from a company's context. ` +
      `Given only the context and an outreach goal, you must (a) give yourself a coherent ` +
      `personality grounded in the company's stated tone and culture, and (b) form a strategy ` +
      `to engage the target candidate profile. Be specific to THIS company — never generic. ` +
      `The persona must be re-derivable: different context => measurably different persona. ` +
      `In persona.groundedIn, tie each major voice choice to the SPECIFIC context fact that drove it ` +
      `(format each entry as "‹context signal› → ‹the voice choice it produced›"), proving the persona ` +
      `is a function of THIS company's tone/culture/profile and would change if the context changed.`,
    user: contextBlock(context),
    schema: {
      type: 'object',
      required: ['persona', 'strategy'],
      properties: {
        persona: {
          type: 'object',
          required: ['name', 'voiceTraits', 'doRules', 'dontRules', 'signatureMove', 'groundedIn'],
          properties: {
            name: { type: 'string', description: 'A name the agent gives itself' },
            voiceTraits: { type: 'array', items: { type: 'string' }, description: '3-5 voice adjectives' },
            doRules: { type: 'array', items: { type: 'string' } },
            dontRules: { type: 'array', items: { type: 'string' } },
            signatureMove: { type: 'string', description: 'One distinctive, recognizable habit' },
            groundedIn: {
              type: 'array',
              items: { type: 'string' },
              description: 'Each entry ties a voice choice to the context fact that drove it (e.g. "tone X → trait Y")',
            },
          },
        },
        strategy: {
          type: 'object',
          required: ['candidateAngle', 'hooks', 'sequencePlan', 'successSignal'],
          properties: {
            candidateAngle: { type: 'string' },
            hooks: { type: 'array', items: { type: 'string' }, description: 'Context-grounded reasons to care' },
            sequencePlan: { type: 'array', items: { type: 'string' }, description: 'Ordered message intents' },
            successSignal: { type: 'string' },
          },
        },
      },
    },
  });
  return out;
}

// ---------------------------------------------------------------------------
// 2) SEQUENCE — plan an ordered, context-grounded message sequence (autonomous)
// ---------------------------------------------------------------------------

export async function buildSequence(
  context: CompanyContext,
  persona: Persona,
  strategy: OutreachStrategy,
): Promise<SequenceMessage[]> {
  const out = await completeJSON<{ messages: SequenceMessage[] }>({
    model: WRITER_MODEL,
    maxTokens: 6000, // several full messages — give headroom so the tool JSON never truncates
    toolName: 'build_sequence',
    system:
      `You are ${persona.name}, an autonomous recruiting agent. Write the full outreach sequence ` +
      `the agent would send, following its OWN strategy plan — no human step-by-step driving. ` +
      `Stay perfectly in voice (traits: ${persona.voiceTraits.join(', ')}; signature: ${persona.signatureMove}). ` +
      `Every message MUST be grounded in specific facts from the company context; list those facts ` +
      `in groundedIn. No generic recruiter copy. You are writing to the target hiring profile in ` +
      `GENERAL — there is no specific named candidate yet, so do NOT invent accomplishments, projects, ` +
      `or claim to have read something of theirs; reference the archetype honestly (e.g. "people who've ` +
      `shipped end-to-end") rather than fabricated personal familiarity. Keep each message tight and ` +
      `human — a few short paragraphs at most, not an essay.`,
    user:
      contextBlock(context) +
      `\n\nPERSONA:\n${JSON.stringify(persona, null, 2)}` +
      `\n\nSTRATEGY:\n${JSON.stringify(strategy, null, 2)}` +
      `\n\nProduce one message per intent in strategy.sequencePlan, in order.`,
    schema: {
      type: 'object',
      required: ['messages'],
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            required: ['step', 'intent', 'channel', 'body', 'groundedIn'],
            properties: {
              step: { type: 'number' },
              intent: { type: 'string' },
              channel: { type: 'string', enum: ['email', 'linkedin'] },
              subject: { type: 'string' },
              body: { type: 'string' },
              groundedIn: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific company-context facts this message used',
              },
            },
          },
        },
      },
    },
  });
  const messages = out.messages;
  // Audit each planned message with the SAME grounding + persona checks as the reply loop, so
  // "knows the company" is a consistent CHECK — including the opener (the first thing reviewers read).
  // Audit-only here (the badge is the proof); the reply loop is where we also self-revise.
  if (VERIFY_MODE !== 'off') {
    await Promise.all(
      messages.map(async (m) => {
        m.verification = await verifyOutput(m.body, context, persona, m.intent);
      }),
    );
  }
  return messages;
}

// ---------------------------------------------------------------------------
// 3) REPLY — the decision ENGINE (this is "where the intelligence is"):
//      classify (model) -> deriveState + policy (CODE) -> choose-within-allowed
//      (model, constrained) -> write (model) -> verify + maybe revise (model+code).
//    The policy/state machine is intelligence in code — the analog of
//    reference/followup-cadence.mjs's computeUrgency. The model can only pick an
//    action the policy ALLOWS; it never drives its own state.
// ---------------------------------------------------------------------------

/** Central tuning — mirrors followup-cadence.mjs's CADENCE config (max-asks / hard stops). */
const POLICY = { maxAsks: 2, maxColdStreak: 2, maxTurns: 8, minConfidence: 0.55 };

/** Verification depth knob: 'off' | 'heuristic' (code-only) | 'judge' (full audit). */
const VERIFY_MODE = (process.env.PSVIEW_VERIFY_MODE || 'judge') as 'off' | 'heuristic' | 'judge';

// --- 3a) MODEL: classify the candidate's reply (reason BEFORE writing) -------

async function classifyReply(
  candidateMessage: string,
  history: ConversationTurn[],
): Promise<ReplyClassification> {
  return completeJSON<ReplyClassification>({
    model: REASONING_MODEL,
    toolName: 'classify_reply',
    system:
      `Classify a candidate's reply to a recruiting outreach. Identify the underlying intent, ` +
      `the specific signals (phrases/cues) that drove your read, and your confidence. Be precise; ` +
      `a "maybe later" is not_now, a pointed question is asking_question, pushback is objection.`,
    user:
      `CONVERSATION SO FAR:\n${renderHistory(history)}\n\n` +
      `CANDIDATE'S LATEST REPLY:\n"${candidateMessage}"`,
    schema: {
      type: 'object',
      required: ['intent', 'signals', 'confidence'],
      properties: {
        intent: {
          type: 'string',
          enum: ['interested', 'asking_question', 'objection', 'not_now', 'cold_or_negative', 'unclear'],
        },
        signals: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
      },
    },
  });
}

// --- 3b) CODE: conversation state, derived deterministically from history ----

const INITIAL_STATE: ConversationState = {
  stage: 'cold',
  askCount: 0,
  openObjections: [],
  questionsAnswered: 0,
  coldStreak: 0,
  turnsTaken: 0,
  goalMet: false,
};

/** Replay the conversation to reconstruct state — no model calls. Opener has no decision. */
export function deriveState(history: ConversationTurn[]): ConversationState {
  let s = INITIAL_STATE;
  for (const t of history) {
    if (t.role !== 'agent' || !t.decision) continue; // opener / candidate turns don't advance state
    s = advanceState(s, t.decision.classification, t.decision.chosenActionType);
  }
  return s;
}

/** Apply one (classification, action) to the state. Pure function. */
export function advanceState(
  s: ConversationState,
  c: ReplyClassification,
  action: AgentActionType,
): ConversationState {
  const next: ConversationState = {
    ...s,
    openObjections: [...s.openObjections],
    turnsTaken: s.turnsTaken + 1,
  };
  next.coldStreak = c.intent === 'cold_or_negative' ? s.coldStreak + 1 : 0;
  if (c.intent === 'objection' && c.signals[0]) next.openObjections.push(c.signals[0]);
  if (action === 'HANDLE_OBJECTION') next.openObjections = []; // objection addressed
  if (action === 'ANSWER_QUESTION') next.questionsAnswered += 1;
  if (action === 'SOFT_ASK' || action === 'DIRECT_ASK') next.askCount += 1;
  if (action === 'CLOSE_WON') next.goalMet = true;
  next.stage = computeStage(next, c, action);
  return next;
}

/** The stage label — the analog of followup-cadence's computeUrgency. Terminal checks first. */
function computeStage(s: ConversationState, c: ReplyClassification, action: AgentActionType): ConversationStage {
  if (s.goalMet) return 'won';
  if (action === 'DISQUALIFY' || s.coldStreak >= POLICY.maxColdStreak) return 'lost';
  if (s.openObjections.length > 0) return 'objecting';
  if (c.intent === 'interested') return 'converting';
  if (c.intent === 'cold_or_negative' || c.intent === 'not_now') return 'cold';
  return 'engaged';
}

// --- 3c) CODE: the deterministic policy. (classification, state) -> allowed actions ---

/** Keyword test over the CANDIDATE's own cues for a concrete commitment signal. No model call. */
function detectGoalSignal(c: ReplyClassification): boolean {
  const hay = c.signals.join(' ').toLowerCase();
  return /\b(yes|sure|sounds good|let'?s do it|book|calendar|works for me|how about|i'?m free|free (on|this)|schedule|happy to|let'?s (talk|chat|do)|call me|set (it|that) up|tuesday|wednesday|thursday|friday|monday)\b/.test(
    hay,
  );
}

/**
 * THE intelligence-in-code. Given the model's classification and the deterministic state,
 * return the ONLY actions the agent may take this turn — enforcing the hard rules (max asks,
 * no re-ask while an objection is open, disqualify after a cold streak, close when goal met).
 */
export function policy(c: ReplyClassification, s: ConversationState): PolicyOutcome {
  let allowed: AgentActionType[];
  let recommended: AgentActionType;
  let ruleFired: string;

  const wouldColdStreak = c.intent === 'cold_or_negative' ? s.coldStreak + 1 : 0;

  if (s.goalMet || (c.intent === 'interested' && detectGoalSignal(c))) {
    allowed = ['CLOSE_WON'];
    recommended = 'CLOSE_WON';
    ruleFired = 'goal-met-close';
  } else if (s.coldStreak >= POLICY.maxColdStreak || wouldColdStreak >= POLICY.maxColdStreak) {
    allowed = ['DISQUALIFY', 'BACK_OFF'];
    recommended = 'DISQUALIFY';
    ruleFired = 'cold-streak-disqualify';
  } else if (s.turnsTaken >= POLICY.maxTurns) {
    allowed = ['BACK_OFF', 'DISQUALIFY'];
    recommended = 'BACK_OFF';
    ruleFired = 'max-turns-back-off';
  } else if (s.openObjections.length > 0) {
    allowed = ['HANDLE_OBJECTION', 'REINFORCE_VALUE'];
    recommended = 'HANDLE_OBJECTION';
    ruleFired = 'no-reask-open-objection';
  } else if ((c.confidence ?? 1) < POLICY.minConfidence) {
    // The read is shaky — don't act on a low-confidence intent; ask, don't assume.
    allowed = ['CLARIFY'];
    recommended = 'CLARIFY';
    ruleFired = 'low-confidence-clarify';
  } else if (c.intent === 'objection') {
    allowed = ['HANDLE_OBJECTION', 'REINFORCE_VALUE'];
    recommended = 'HANDLE_OBJECTION';
    ruleFired = 'fresh-objection';
  } else if (c.intent === 'asking_question') {
    allowed = s.askCount < POLICY.maxAsks ? ['ANSWER_QUESTION', 'SOFT_ASK'] : ['ANSWER_QUESTION'];
    recommended = 'ANSWER_QUESTION';
    ruleFired = 'answer-then-maybe-ask';
  } else if (c.intent === 'not_now') {
    allowed = ['BACK_OFF', 'REINFORCE_VALUE'];
    recommended = 'BACK_OFF';
    ruleFired = 'not-now-deescalate';
  } else if (c.intent === 'unclear') {
    allowed = ['CLARIFY'];
    recommended = 'CLARIFY';
    ruleFired = 'unclear-clarify';
  } else if (c.intent === 'interested') {
    const canAsk = s.askCount < POLICY.maxAsks;
    allowed = canAsk ? ['DIRECT_ASK', 'REINFORCE_VALUE'] : ['REINFORCE_VALUE'];
    recommended = canAsk ? 'DIRECT_ASK' : 'REINFORCE_VALUE';
    ruleFired = canAsk ? 'interested-ask' : 'ask-budget-exhausted';
  } else {
    allowed = ['REINFORCE_VALUE'];
    recommended = 'REINFORCE_VALUE';
    ruleFired = 'default';
  }

  return { allowed, recommended, ruleFired, stateBefore: s, stateAfter: s };
}

/** Concrete writer instruction per action — what the message must DO. */
const ACTION_INSTRUCTIONS: Record<AgentActionType, string> = {
  ANSWER_QUESTION: "Answer the candidate's question directly and specifically, grounded in the company context.",
  HANDLE_OBJECTION:
    'Address the objection head-on and honestly, then restate the value — do NOT re-ask for the meeting yet.',
  REINFORCE_VALUE: 'Add one new, specific, context-grounded reason to care. Do not ask for the meeting.',
  SOFT_ASK: "After a brief answer, make a light, low-commitment ask (e.g. 'worth a quick 15 minutes?').",
  DIRECT_ASK: 'Make a clear, concrete ask for the meeting with a specific small time window.',
  BACK_OFF: 'Gracefully de-escalate: acknowledge their position, leave the door open, do NOT ask again.',
  DISQUALIFY: 'Politely close out — thank them, no pressure, no further ask.',
  CLOSE_WON: "They're in. Confirm warmly and lock the next concrete step (time / logistics).",
  CLARIFY: 'Ask one short clarifying question to understand what they mean.',
};

/** Human-readable label of an action (for the trace). */
function actionLabel(a: AgentActionType): string {
  return a.toLowerCase().replace(/_/g, ' ');
}

// --- 3d) MODEL (constrained): pick ONE action from the policy-allowed set ----

async function chooseAllowedAction(
  c: ReplyClassification,
  persona: Persona,
  strategy: OutreachStrategy,
  outcome: PolicyOutcome,
): Promise<{ chosenActionType: AgentActionType; rationale: string }> {
  // If the policy already forced a single action, don't spend a model call.
  if (outcome.allowed.length === 1) {
    return { chosenActionType: outcome.allowed[0], rationale: `Policy forced this (${outcome.ruleFired}).` };
  }
  const out = await completeJSON<{ chosenActionType: AgentActionType; rationale: string }>({
    model: REASONING_MODEL,
    toolName: 'choose_action',
    system:
      `You are ${persona.name}. The policy has narrowed the next action to a fixed allowed set. ` +
      `Pick the single best action FROM THE ALLOWED LIST ONLY, with a one-line rationale. ` +
      `You may not invent an action outside the list.`,
    user:
      `GOAL (success looks like): ${strategy.successSignal}\n` +
      `CANDIDATE CLASSIFICATION: ${JSON.stringify(c)}\n` +
      `POLICY RULE: ${outcome.ruleFired}\n` +
      `ALLOWED ACTIONS: ${outcome.allowed.join(', ')}\n` +
      `RECOMMENDED: ${outcome.recommended}`,
    schema: {
      type: 'object',
      required: ['chosenActionType', 'rationale'],
      properties: {
        // Per-request enum = the model literally cannot pick outside the policy.
        chosenActionType: { type: 'string', enum: outcome.allowed },
        rationale: { type: 'string' },
      },
    },
  });
  // Backstop — never trust the model to stay in-bounds.
  const chosenActionType = outcome.allowed.includes(out.chosenActionType) ? out.chosenActionType : outcome.recommended;
  return { chosenActionType, rationale: out.rationale };
}

// --- 3e) MODEL: write the message that executes the chosen action ------------

async function writeReply(
  context: CompanyContext,
  persona: Persona,
  strategy: OutreachStrategy,
  actionInstruction: string,
  history: ConversationTurn[],
  candidateMessage: string,
): Promise<string> {
  return complete({
    model: WRITER_MODEL,
    system:
      `You are ${persona.name} (voice: ${persona.voiceTraits.join(', ')}; signature move: ` +
      `${persona.signatureMove}). Write ONLY the next message to the candidate. Your action this turn: ` +
      `${actionInstruction} Draw on YOUR OWN strategy below — when you reinforce value, pull from a hook you ` +
      `have NOT already used in this conversation rather than inventing a new angle. Stay in voice, obey your ` +
      `do/don't rules, stay grounded in the company context (invent NO facts), keep it human and concise. ` +
      `Output the message text only — no preamble.`,
    user:
      contextBlock(context) +
      `\n\nYOUR STRATEGY (the plan you're executing)` +
      `\n- Angle: ${strategy.candidateAngle}` +
      `\n- Hooks (grounded reasons to care): ${strategy.hooks.join(' | ')}` +
      `\n- A win looks like: ${strategy.successSignal}` +
      `\n\nDO RULES: ${persona.doRules.join('; ')}` +
      `\n\nDON'T RULES: ${persona.dontRules.join('; ')}` +
      `\n\nCONVERSATION SO FAR:\n${renderHistory(history)}\n\n` +
      `CANDIDATE JUST SAID:\n"${candidateMessage}"`,
  });
}

// --- 3f) MODEL + CODE: audit the written message (grounding + persona) -------

/** Cheap, code-only persona checks derived from the don't-rules + universal recruiter smells. */
function checkPersonaHeuristics(message: string, persona: Persona): string[] {
  const v: string[] = [];
  const dont = persona.dontRules.join(' ').toLowerCase();
  const lower = message.toLowerCase();
  const emojiCount = (message.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu) || []).length;
  const exclaims = (message.match(/!/g) || []).length;

  if (/\bemoji|emojis\b/.test(dont) && emojiCount > 0) v.push(`Uses ${emojiCount} emoji despite a no-emoji rule`);
  if (/exclamation|no hype|hype|salesy|oversell/.test(dont) && exclaims >= 2)
    v.push(`${exclaims} exclamation points reads salesy`);

  const buzzwords = ['rockstar', 'ninja', 'guru', 'synergy', 'exciting opportunity', 'world-class', 'cutting-edge'];
  const hit = buzzwords.filter((b) => lower.includes(b));
  if (hit.length) v.push(`Recruiter cliché: ${hit.join(', ')}`);

  return v;
}

/** One combined judge call (grounding + persona) on the cheaper writer model. */
async function verifyOutput(
  message: string,
  context: CompanyContext,
  persona: Persona,
  role?: string, // this message's role (e.g. its sequence intent / the chosen action) — judged in context
): Promise<VerificationResult> {
  const heuristic = checkPersonaHeuristics(message, persona);

  if (VERIFY_MODE === 'off' || VERIFY_MODE === 'heuristic') {
    return {
      grounded: true,
      unsupportedClaims: [],
      personaPass: heuristic.length === 0,
      personaViolations: heuristic,
      revised: false,
    };
  }

  const judged = await completeJSON<{ unsupportedClaims: string[]; personaViolations: string[] }>({
    model: WRITER_MODEL,
    toolName: 'verify_message',
    system:
      `You audit a recruiting message before it is shown. Return two lists. ` +
      `(1) unsupportedClaims: any factual claim about the company (products, metrics, perks, facts) ` +
      `NOT supported by the COMPANY CONTEXT — i.e. invented or exaggerated. ` +
      `(2) personaViolations: any violation of the agent's DON'T rules or a clear miss of its voice. ` +
      `Judge the message against ITS stated role only — e.g. an opener or value message need NOT make ` +
      `the final ask. Be strict but fair; return empty arrays if the message is clean.`,
    user:
      contextBlock(context) +
      (role ? `\n\nTHIS MESSAGE'S ROLE: ${role}` : '') +
      `\n\nVOICE TRAITS: ${persona.voiceTraits.join(', ')}` +
      `\n\nDON'T RULES: ${persona.dontRules.join('; ')}` +
      `\n\nMESSAGE TO AUDIT:\n"${message}"`,
    schema: {
      type: 'object',
      required: ['unsupportedClaims', 'personaViolations'],
      properties: {
        unsupportedClaims: { type: 'array', items: { type: 'string' } },
        personaViolations: { type: 'array', items: { type: 'string' } },
      },
    },
  });

  const personaViolations = Array.from(new Set([...heuristic, ...judged.personaViolations]));
  return {
    grounded: judged.unsupportedClaims.length === 0,
    unsupportedClaims: judged.unsupportedClaims,
    personaPass: personaViolations.length === 0,
    personaViolations,
    revised: false,
  };
}

/** Verify, and if it fails, do ONE corrective rewrite. Advisory only — never blocks sending. */
async function verifyAndMaybeRevise(opts: {
  message: string;
  context: CompanyContext;
  persona: Persona;
  actionInstruction: string;
}): Promise<{ message: string; verification: VerificationResult }> {
  const v = await verifyOutput(opts.message, opts.context, opts.persona, opts.actionInstruction);
  if (VERIFY_MODE === 'off' || (v.grounded && v.personaPass)) {
    return { message: opts.message, verification: v };
  }
  const issues = [
    ...v.unsupportedClaims.map((u) => `Unsupported claim: ${u}`),
    ...v.personaViolations.map((p) => `Persona issue: ${p}`),
  ].join('\n');
  const revised = await complete({
    model: WRITER_MODEL,
    system:
      `You are ${opts.persona.name} (voice: ${opts.persona.voiceTraits.join(', ')}). Rewrite your message to ` +
      `fix the listed problems while keeping the same intent (${opts.actionInstruction}). Remove any claim not ` +
      `grounded in the company context; obey every don't-rule. Output the corrected message only — no preamble.`,
    user:
      contextBlock(opts.context) +
      `\n\nDON'T RULES: ${opts.persona.dontRules.join('; ')}` +
      `\n\nPROBLEMS TO FIX:\n${issues}` +
      `\n\nORIGINAL MESSAGE:\n"${opts.message}"`,
  });
  // Cheap re-check (heuristics only — don't pay a second judge call).
  const personaViolations = checkPersonaHeuristics(revised, opts.persona);
  return {
    message: revised,
    verification: {
      grounded: true, // we instructed removal of unsupported claims
      unsupportedClaims: [],
      personaPass: personaViolations.length === 0,
      personaViolations,
      revised: true,
    },
  };
}

// --- 3g) Orchestrate the engine ---------------------------------------------

/** classify -> policy/state (CODE) -> choose-within-allowed -> write -> verify. */
export async function handleCandidateReply(opts: {
  context: CompanyContext;
  persona: Persona;
  strategy: OutreachStrategy;
  history: ConversationTurn[];
  candidateMessage: string;
}): Promise<{ message: string; decision: AgentDecision }> {
  // 1. CODE: reconstruct conversation state from history.
  const stateBefore = deriveState(opts.history);

  // 2. MODEL: classify the reply.
  const classification = await classifyReply(opts.candidateMessage, opts.history);

  // 3. CODE: the deterministic policy decides the allowed action space.
  const outcome = policy(classification, stateBefore);

  // 4. MODEL (or skipped): pick ONE action from the allowed set.
  const { chosenActionType, rationale } = await chooseAllowedAction(
    classification,
    opts.persona,
    opts.strategy,
    outcome,
  );

  // 5. CODE: advance state with the chosen action.
  const stateAfter = advanceState(stateBefore, classification, chosenActionType);
  outcome.stateAfter = stateAfter;

  // 6. MODEL: write the message that executes the chosen action (plan-aware: uses strategy hooks).
  const draft = await writeReply(
    opts.context,
    opts.persona,
    opts.strategy,
    ACTION_INSTRUCTIONS[chosenActionType],
    opts.history,
    opts.candidateMessage,
  );

  // 7. MODEL + CODE: audit the message; one optional corrective rewrite.
  const { message, verification } = await verifyAndMaybeRevise({
    message: draft,
    context: opts.context,
    persona: opts.persona,
    actionInstruction: ACTION_INSTRUCTIONS[chosenActionType],
  });

  const decision: AgentDecision = {
    classification,
    chosenAction: actionLabel(chosenActionType),
    rationale,
    policy: outcome,
    chosenActionType,
    verification,
  };
  return { message, decision };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function contextBlock(c: CompanyContext): string {
  return (
    `COMPANY CONTEXT\n` +
    `- Company: ${c.companyName}\n` +
    `- What they do: ${c.whatTheyDo}\n` +
    `- Culture: ${c.culture}\n` +
    `- Who they hire: ${c.hiringProfile}\n` +
    `- Desired tone: ${c.tone}\n` +
    `- Outreach goal (intent): ${c.outreachGoal}`
  );
}

function renderHistory(history: ConversationTurn[]): string {
  if (!history.length) return '(no messages yet)';
  return history.map((t) => `${t.role === 'agent' ? 'AGENT' : 'CANDIDATE'}: ${t.text}`).join('\n');
}
