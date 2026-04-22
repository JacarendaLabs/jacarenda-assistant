/**
 * Runtime context every tool receives.
 *
 * Tool implementations MUST use this to derive their credential source
 * and data scope — never read global env directly for anything
 * tenant-specific.
 */

import type { Agent } from "../agent-store.js";

export interface ToolContext {
  agent: Agent;
  runId: string;
  tenantId: string;
}

export interface ToolImpl<TInput = unknown> {
  /** Tool identifier — must appear in `TOOLS` registry (tools.ts) and match
   * the id agents store in `tool_allowlist_json`. */
  readonly id: string;
  /** True if the tool performs any side effect outside the sandbox. Gated
   * by trust mode at dispatch time. */
  readonly isMutating: boolean;
  /** Zod schema (strict) for the tool input. Never `z.any()` / `z.unknown()`. */
  readonly inputSchema: {
    safeParse: (v: unknown) => {
      success: boolean;
      data?: TInput;
      error?: { message: string };
    };
  };
  /** Anthropic input schema — must be a plain JSON Schema object. */
  readonly anthropicInputSchema: Record<string, unknown>;
  /** Human-readable description shown to the LLM. */
  readonly description: string;
  /** Execute the tool. Return value is serialised via JSON.stringify
   * before being handed back to the LLM; keep it small + structured. */
  execute(input: TInput, ctx: ToolContext): Promise<unknown>;
}

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "input_validation"
      | "not_in_allowlist"
      | "unknown_tool"
      | "credential_missing"
      | "upstream_failure"
      | "approval_required",
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}
