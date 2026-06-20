// Typed contracts for the whole agent. Mirrors career-ops's "structured context, not
// free text" discipline: the form captures a typed CompanyContext, the agent derives a
// typed Persona + Strategy, and every message carries the context facts it was grounded in.

/** What the recruiter fills in. The agent's entire world comes from this. */
export interface CompanyContext {
  companyName: string;
  whatTheyDo: string;          // one-liner + a sentence on the product
  culture: string;            // values, working style, what they care about
  hiringProfile: string;      // the kind of person they're trying to engage
  tone: string;               // desired voice, e.g. "warm, direct, a little playful"
  /** The intent the agent is given. It plans the rest autonomously from this. */
  outreachGoal: string;       // e.g. "get a senior infra eng to take a 20-min intro call"
}

/** The agent's self-configured personality. Derived, typed, consistent, and re-derivable. */
export interface Persona {
  name: string;               // the agent gives itself a name
  voiceTraits: string[];      // 3–5 adjectives that define the voice
  doRules: string[];          // concrete "always" rules
  dontRules: string[];        // concrete "never" rules
  signatureMove: string;      // one distinctive habit that makes the voice recognizable
  groundedIn: string[];       // each entry ties a voice choice to the context fact that drove it
                              // (proves the persona is company-specific → changes when reconfigured)
}

/** The plan the agent forms from the goal + context, before writing anything. */
export interface OutreachStrategy {
  candidateAngle: string;     // why THIS company should appeal to THIS profile
  hooks: string[];            // specific, context-grounded reasons-to-care
  sequencePlan: string[];     // ordered intents, e.g. ["open + relevance", "value", "soft ask"]
  successSignal: string;      // what a "win" reply looks like
}

/** One planned outreach message in the sequence. */
export interface SequenceMessage {
  step: number;
  intent: string;             // what this message is FOR (opener / value / ask / nudge)
  channel: 'email' | 'linkedin';
  subject?: string;
  body: string;
  groundedIn: string[];       // which CompanyContext facts this message used (no generic copy)
  verification?: VerificationResult; // same audit as the reply loop — incl. the opener
}

/** Classification of a (simulated) candidate reply — the "reason before write" step. */
export interface ReplyClassification {
  intent:
    | 'interested'
    | 'asking_question'
    | 'objection'
    | 'not_now'
    | 'cold_or_negative'
    | 'unclear';
  signals: string[];          // phrases/cues that drove the classification
  confidence: number;         // 0–1
}

// ---------------------------------------------------------------------------
// The decision engine — intelligence in CODE, not a prompt. Mirrors the lineage of
// reference/followup-cadence.mjs (computeUrgency / cadence thresholds / hard stops): a
// deterministic policy + finite-state machine gates the model. The model only picks an
// action from the policy-allowed set and writes — it cannot drive its own state.
// ---------------------------------------------------------------------------

/** Where the conversation is — the stage label (analog of followup-cadence's urgency label). */
export type ConversationStage = 'cold' | 'engaged' | 'objecting' | 'converting' | 'won' | 'lost';

/** Structured, accumulating conversation state — recomputed from history each turn. */
export interface ConversationState {
  stage: ConversationStage;
  askCount: number;           // how many times we've asked for the meeting (analog of followupCount)
  openObjections: string[];   // objection signals raised but not yet addressed
  questionsAnswered: number;
  coldStreak: number;         // consecutive cold/negative replies → disqualify
  turnsTaken: number;         // runaway guard
  goalMet: boolean;
}

/** The constrained action space. The policy decides which of these are ALLOWED this turn. */
export type AgentActionType =
  | 'ANSWER_QUESTION'
  | 'HANDLE_OBJECTION'
  | 'REINFORCE_VALUE'
  | 'SOFT_ASK'
  | 'DIRECT_ASK'
  | 'BACK_OFF'
  | 'DISQUALIFY'
  | 'CLOSE_WON'
  | 'CLARIFY';

/** The audited output of the deterministic policy (the "where the intelligence is" object). */
export interface PolicyOutcome {
  allowed: AgentActionType[]; // the ONLY actions the model may choose from this turn
  recommended: AgentActionType;
  ruleFired: string;          // which policy rule decided this (e.g. "no-reask-open-objection")
  stateBefore: ConversationState;
  stateAfter: ConversationState;
}

/** Result of auditing the written message: is it grounded + in persona, and did we revise? */
export interface VerificationResult {
  grounded: boolean;
  unsupportedClaims: string[]; // claims about the company not supported by the context
  personaPass: boolean;
  personaViolations: string[]; // do/don't-rule or voice violations
  revised: boolean;            // whether one auto-revision was applied
}

/** The decision the agent makes after classifying — visible "where the intelligence is". */
export interface AgentDecision {
  classification: ReplyClassification;
  chosenAction: string;             // human-readable label of the chosen action
  rationale: string;                // why this action, given the allowed set + state
  policy: PolicyOutcome;            // the deterministic decision (state + allowed + rule)
  chosenActionType: AgentActionType; // the enum the model picked FROM policy.allowed
  verification?: VerificationResult; // output audit (optional: opener turns have none)
}

/** A turn in the simulated conversation. */
export interface ConversationTurn {
  role: 'agent' | 'candidate';
  text: string;
  decision?: AgentDecision;   // present on agent turns that followed a candidate reply
}

/** The full configured agent — returned by /api/configure and held in the UI. */
export interface ConfiguredAgent {
  context: CompanyContext;
  persona: Persona;
  strategy: OutreachStrategy;
}
