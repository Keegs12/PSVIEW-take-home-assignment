// Thin Anthropic wrapper. Two helpers: free-text completion, and a JSON completion that
// forces the model to return a typed object via tool-use (more reliable than "respond in JSON").
//
// Model choice (see .env.example): the reasoning/classification step uses the strongest model
// (Opus 4.8 by default) because that's "where the intelligence is"; the writing loop uses a
// fast capable model (Sonnet 4.6). Per the claude-api guidance, default to the latest models.

import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  // Surface a clear server-side error instead of a cryptic SDK failure.
  console.warn('[claude] ANTHROPIC_API_KEY is not set — API routes will fail until it is.');
}

export const anthropic = new Anthropic({ apiKey: apiKey ?? 'missing' });

export const REASONING_MODEL = process.env.PSVIEW_REASONING_MODEL || 'claude-opus-4-8';
export const WRITER_MODEL = process.env.PSVIEW_WRITER_MODEL || 'claude-sonnet-4-6';
// Web-research → form extraction. Not the "intelligence" step (that's the reasoning model),
// so it defaults to the fast writer tier to keep per-research cost low. Override via env.
export const RESEARCH_MODEL = process.env.PSVIEW_RESEARCH_MODEL || WRITER_MODEL;

/** Free-text completion. */
export async function complete(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const res = await anthropic.messages.create({
    model: opts.model || WRITER_MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });
  const block = res.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

/**
 * Structured completion: forces the model to call a single tool whose input_schema is the
 * shape we want back. Returns the validated tool input as T. This is how we get reliable,
 * typed Persona / Strategy / Classification objects instead of parsing prose.
 */
export async function completeJSON<T>(opts: {
  system: string;
  user: string;
  toolName: string;
  schema: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const res = await anthropic.messages.create({
    model: opts.model || REASONING_MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    tools: [
      {
        name: opts.toolName,
        description: `Return the result as structured data via this tool.`,
        input_schema: opts.schema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: opts.toolName },
    messages: [{ role: 'user', content: opts.user }],
  });
  // A truncated tool call yields malformed/partial input — fail loudly instead of returning garbage.
  if (res.stop_reason === 'max_tokens') {
    throw new Error('Structured response was truncated (hit max_tokens) — raise maxTokens for this call.');
  }
  const toolUse = res.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Model did not return structured tool output');
  }
  return toolUse.input as T;
}
