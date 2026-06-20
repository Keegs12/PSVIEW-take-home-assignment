# Autonomous Recruiting Agent — PSVIEW take-home

An agent that **configures itself** from a company's context, **plans a grounded outreach sequence**, and **reasons over candidate replies** — all in a deployed preview app (nothing is sent for real).

**Live URL:** https://psview-take-home-assignment.vercel.app · **Repo:** https://github.com/Keegs12/PSVIEW-take-home-assignment

---

## What makes it intelligent, and not just an LLM call

> **The intelligence is a decision engine in code, not a prompt.** On every candidate reply, a deterministic **policy + conversation-state machine** — the analog of the proven candidate-side system's cadence logic — decides the *allowed* next actions; the model may only pick one from that set (enforced via a per-request enum), then write. The message is then **audited** — grounded against the company context and checked against the persona's rules, with one auto-revision on failure. Every step is shown on screen: the state transition, the policy rule that fired, the allowed-vs-chosen action, and the verification result. The model is boxed in by code — it doesn't drive itself.

---

## What I built

A single-screen app with four stages:

1. **Company context form** — captures who the company is, culture, the profile it hires, tone, and the outreach goal (the *intent* the agent is given).
2. **Self-configuration** — the agent derives a **typed persona** (name, voice traits, do/don't rules, a signature move) and a **strategy** (angle, hooks, sequence plan, what a win looks like) *from the context alone* — and shows **which context fact drove each trait**, so the personality is visibly a function of *this* company. Change the context → the persona measurably changes.
3. **Planned sequence** — it writes the full outreach sequence itself from its own plan (no step-by-step driving). Each message lists the **specific context facts it was grounded in** and is **audited for grounding + persona** — the same checks the live reply loop runs.
4. **Conversation simulator** — type a candidate reply by hand and watch the decision engine run: **read → decide the allowed actions in code → pick one → write → audit**, with the full trace (state transition, policy rule, allowed/chosen action, grounding + persona checks) rendered above each agent message.

## Key choices

- **Decide in code, not in a prompt.** The hard part of the brief is "intelligent, not text gen." So the reply handler is a real engine: `classifyReply` (model) → `deriveState` + `policy` (**deterministic code** — the `computeUrgency` analog from the reference's `followup-cadence.mjs`) → `chooseAllowedAction` (model, constrained to the policy's allowed set via a per-request enum) → `writeReply` → `verifyAndMaybeRevise` (grounding + persona audit). The model can't pick an action the code forbids, and its output is checked, not trusted. The whole chain is surfaced in the UI.
- **Structured persona/strategy via tool-use.** The agent's personality and plan are returned as **typed JSON** (Anthropic tool-use with an `input_schema`), not prose. That's what makes the personality *consistent and configurable* — and trivially re-derivable from a different context.
- **Grounding is checked, not claimed.** Every generated message carries a `groundedIn` list **and** is run through a verifier (grounding against the company context + persona-rule adherence) — in both the planned sequence and the live conversation, with one auto-revision on failure in the reply loop.
- **Two models by tier.** The reasoning/classification steps use the strongest model (Opus 4.8); the writing loop uses a fast capable model (Sonnet 4.6). Both configurable via env.
- **Stack:** Next.js (App Router) + TypeScript + the Anthropic SDK, deploy on Vercel. Server-side API routes keep the API key off the client.

## Architecture

```
form ─▶ POST /api/configure ─▶ configureAgent()   → typed Persona + Strategy   (reasoning model)
                                   │
        POST /api/sequence  ─▶ buildSequence()     → grounded message sequence  (writer model)
                                   │
        POST /api/reply     ─▶ handleCandidateReply()   — the decision engine
                                   ├─ deriveState() + policy()   CODE  · state machine + allowed actions
                                   ├─ classifyReply()            model · read the reply
                                   ├─ chooseAllowedAction()      model · pick within the allowed set (enum)
                                   ├─ writeReply()               model · execute the chosen action
                                   └─ verifyAndMaybeRevise()     audit · grounding + persona, 1 revision
                                                                 ↳ all surfaced as the reasoning trace
```

The brain is `src/lib/agent.ts` (the policy/state machine + verification are plain code there); the contracts are `src/lib/types.ts`; the Claude wrapper (incl. typed tool-use JSON) is `src/lib/claude.ts`.

## Run locally

```bash
cp .env.example .env.local      # add your ANTHROPIC_API_KEY
npm install
npm run dev                     # http://localhost:3000
```

## Configuration

Set on the host (Vercel project settings, or `.env.local` for local runs):

- `ANTHROPIC_API_KEY` — **required**
- `PSVIEW_REASONING_MODEL` / `PSVIEW_WRITER_MODEL` / `PSVIEW_RESEARCH_MODEL` — optional model overrides
- `PSVIEW_VERIFY_MODE` — `judge` (default) · `heuristic` · `off`

Deployed on Vercel; API routes run server-side so the key never reaches the client.

---

<sub>Design note: the architecture (context → typed persona → grounded generation → an audited decision engine) is the recruiter-side mirror of a candidate-side outreach system I've worked inside — same DNA (structured context, a consistent + configurable persona, grounded generation, and deterministic policy in code), pointed the other way. So I understand both ends of this conversation.</sub>
