/**
 * Anthropic SDK wrapper for the agent runtime.
 *
 * Phase 2.1a: a single non-streaming completion. Tool use lands in 2.2.
 * Streaming comes later (tests will stay non-streaming for determinism).
 *
 * All runs are billed against the agent's `spend_cap_cents`. For now
 * we return usage counts from the SDK and let the caller translate to
 * cents; a proper cost table lands in 2.5 (spend-cap enforcement).
 */

import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Set it as a Fly secret on vellum-gateway.",
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

export interface LlmCompleteInput {
  system: string;
  userMessage: string;
  /** Hard cap — protects against runaway generations. */
  maxTokens?: number;
  /** Default: Sonnet 4.6 (best balance for agent work). */
  model?: string;
}

export interface LlmCompleteResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: string;
  model: string;
}

export async function llmComplete(
  input: LlmCompleteInput,
): Promise<LlmCompleteResult> {
  const model = input.model ?? "claude-sonnet-4-6";
  const response = await getClient().messages.create({
    model,
    max_tokens: input.maxTokens ?? 1024,
    system: input.system,
    messages: [{ role: "user", content: input.userMessage }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  const text = textBlock?.text ?? "";

  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    stopReason: response.stop_reason ?? "unknown",
    model,
  };
}

/**
 * Rough cost estimate in cents. Sonnet 4.6 pricing: $3/MTok input, $15/MTok
 * output as of 2026-04. Keep this coarse — spend-cap enforcement (phase 2.5)
 * will refine with a proper per-model table.
 */
export function estimateCostCents(usage: LlmCompleteResult["usage"]): number {
  const inputCost = (usage.inputTokens / 1_000_000) * 3_00; // 300 cents / MTok
  const outputCost = (usage.outputTokens / 1_000_000) * 15_00; // 1500 cents / MTok
  return Math.ceil(inputCost + outputCost);
}
