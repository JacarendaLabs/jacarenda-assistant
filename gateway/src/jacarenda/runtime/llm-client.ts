/**
 * Anthropic SDK wrapper for the agent runtime.
 *
 * Phase 2.2a: multi-turn conversations with tool support. Streaming
 * still deferred. Singleton client, single source of ANTHROPIC_API_KEY read.
 */

import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Set it as a Fly secret on the gateway app.",
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

export type LlmMessage =
  | { role: "user"; content: string | Anthropic.ToolResultBlockParam[] }
  | {
      role: "assistant";
      content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>;
    };

export interface LlmTool {
  /** Anthropic requires tool names to match /^[a-zA-Z0-9_-]{1,64}$/ —
   * we pass the slug here (our tool ids are remapped via toAnthropicName). */
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmTurnInput {
  system: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens?: number;
  model?: string;
}

export interface LlmTurnResult {
  content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>;
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export async function llmTurn(input: LlmTurnInput): Promise<LlmTurnResult> {
  const model = input.model ?? "claude-sonnet-4-6";
  const response = await getClient().messages.create({
    model,
    max_tokens: input.maxTokens ?? 1024,
    system: input.system,
    messages: input.messages as Anthropic.MessageParam[],
    ...(input.tools && input.tools.length > 0
      ? {
          tools: input.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          })),
        }
      : {}),
  });

  return {
    content: response.content as Array<
      Anthropic.TextBlock | Anthropic.ToolUseBlock
    >,
    stopReason: response.stop_reason ?? "unknown",
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model,
  };
}

/**
 * Rough cost estimate in cents. Sonnet 4.6 pricing: $3/MTok input, $15/MTok
 * output as of 2026-04. Spend-cap enforcement (phase 2.5) will refine with
 * a proper per-model table.
 */
export function estimateCostCents(usage: {
  inputTokens: number;
  outputTokens: number;
}): number {
  const inputCost = (usage.inputTokens / 1_000_000) * 3_00;
  const outputCost = (usage.outputTokens / 1_000_000) * 15_00;
  return Math.ceil(inputCost + outputCost);
}

/**
 * Anthropic tool names must match `^[a-zA-Z0-9_-]{1,64}$` — our canonical
 * tool ids use dots (`fibery.query`). Forward translation; reverse is a
 * lookup against the allowlist the orchestrator built for the turn
 * (lookup is safer than string-mangling in reverse).
 */
export function toAnthropicName(toolId: string): string {
  return toolId.replace(/\./g, "_");
}
