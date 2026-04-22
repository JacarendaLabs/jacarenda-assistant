/**
 * Agent orchestrator — multi-turn runs with tool support (Phase 2.2a).
 *
 * Security posture (governed by docs/RUNTIME_SECURITY.md):
 *  - Tenant-scoped agent lookup (never cross-tenant)
 *  - User input capped at MAX_INPUT_CHARS
 *  - Tool allowlist enforced in code BEFORE the Anthropic call (LLM
 *    never sees tools outside the agent's allowlist)
 *  - Every tool-call's input is Zod-validated before execution; failure
 *    is surfaced back to the LLM as a tool_result error and logged
 *  - Unknown tool id (LLM hallucinates) → rejected + logged, run fails
 *  - Turn loop bounded by MAX_TURNS to prevent runaway tool-call loops
 *  - Per-turn LLM timeout
 *  - Trust-mode gate: mutating tool in non-autopilot → ApprovalRequired
 *    (2.3 lands the actual approval dispatch; 2.2a hard-fails the run
 *    so no mutation ever happens without the gate in place)
 *  - All events flow through run-store.appendEvent which redacts
 *    credential-shaped strings before persistence
 *  - Spend-cap logged but not yet enforced (phase 2.5)
 */

import { getAgent, type Agent } from "../agent-store.js";
import { DEFAULT_TENANT_ID } from "../schema.js";
import {
  estimateCostCents,
  llmTurn,
  toAnthropicName,
  type LlmMessage,
  type LlmTool,
} from "./llm-client.js";
import {
  appendEvent,
  finishRun,
  startRun,
  type RunRow,
  type TriggeredBy,
} from "./run-store.js";
import { allToolImpls } from "./tool-registry.js";
import {
  ToolExecutionError,
  type ToolContext,
  type ToolImpl,
} from "./tool-context.js";

const MAX_INPUT_CHARS = 4000;
const LLM_TIMEOUT_MS = 60_000;
const MAX_TURNS = 8;
const MAX_TOOL_RESULT_CHARS = 4000;

export interface RunAgentInput {
  agentId: string;
  tenantId?: string;
  userInput: string;
  triggeredBy: TriggeredBy;
  triggeredByActor?: string;
}

export interface RunAgentResult {
  run: RunRow;
  responseText: string;
}

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "agent_not_found"
      | "input_too_long"
      | "agent_not_runnable"
      | "llm_failed"
      | "tool_failed"
      | "approval_required"
      | "too_many_turns"
      | "internal",
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;

  if (input.userInput.length > MAX_INPUT_CHARS) {
    throw new RuntimeError(
      `Input exceeds ${MAX_INPUT_CHARS} characters.`,
      "input_too_long",
    );
  }

  const agent = getAgent(input.agentId, tenantId);
  if (!agent) {
    throw new RuntimeError("Agent not found.", "agent_not_found");
  }
  if (agent.status === "archived") {
    throw new RuntimeError(
      "Agent is archived and cannot be run.",
      "agent_not_runnable",
    );
  }

  const run = startRun({
    agentId: agent.id,
    tenantId,
    triggeredBy: input.triggeredBy,
    triggeredByActor: input.triggeredByActor,
  });

  appendEvent(run.id, "run_started", {
    triggeredBy: input.triggeredBy,
    triggeredByActor: input.triggeredByActor ?? null,
    userInputChars: input.userInput.length,
    allowlist: agent.toolAllowlist,
  });

  try {
    const resolved = await runLoop(agent, input.userInput, run.id, tenantId);
    const summary = truncate(resolved.text, 500);
    appendEvent(run.id, "run_completed", {
      totalCostCents: resolved.costCents,
      turns: resolved.turns,
      summary,
    });
    const finished = finishRun({
      runId: run.id,
      status: "succeeded",
      totalCostCents: resolved.costCents,
      summary,
    });
    return {
      run: finished ?? { ...run, status: "succeeded", summary },
      responseText: resolved.text,
    };
  } catch (err) {
    const runtimeErr =
      err instanceof RuntimeError
        ? err
        : new RuntimeError(sanitiseError(err), "llm_failed");
    appendEvent(run.id, "error", {
      code: runtimeErr.code,
      message: runtimeErr.message,
    });
    finishRun({
      runId: run.id,
      status: "failed",
      totalCostCents: 0,
      summary: runtimeErr.message,
    });
    throw runtimeErr;
  }
}

/* -------------------------------------------------------------- internals */

async function runLoop(
  agent: Agent,
  userMessage: string,
  runId: string,
  tenantId: string,
): Promise<{ text: string; costCents: number; turns: number }> {
  const systemPrompt = buildSystemPrompt(agent);
  const selectedTools = selectToolsForAgent(agent);
  const llmTools: LlmTool[] = selectedTools.map((t) => ({
    name: toAnthropicName(t.id),
    description: t.description,
    input_schema: t.anthropicInputSchema,
  }));
  const anthropicNameToImpl = new Map<string, ToolImpl>(
    selectedTools.map((t) => [toAnthropicName(t.id), t]),
  );

  const messages: LlmMessage[] = [{ role: "user", content: userMessage }];
  let totalCostCents = 0;
  let finalText = "";

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    appendEvent(runId, "llm_call", {
      model: "claude-sonnet-4-6",
      turn,
      toolCount: llmTools.length,
    });

    const result = await withTimeout(
      llmTurn({
        system: systemPrompt,
        messages,
        tools: llmTools,
        maxTokens: 1024,
      }),
      LLM_TIMEOUT_MS,
      "LLM call timed out after 60s.",
    );

    const costCents = estimateCostCents(result.usage);
    totalCostCents += costCents;

    appendEvent(runId, "llm_response", {
      turn,
      stopReason: result.stopReason,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents,
      blockCount: result.content.length,
    });

    // Accumulate the assistant turn — even if tool_use follows, the
    // assistant's tool_use block must be preserved in the history so
    // the tool_result can reference its id.
    messages.push({ role: "assistant", content: result.content });

    const toolUses = result.content.filter(
      (b): b is Extract<typeof b, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    const textBlocks = result.content.filter(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
    );
    // Always carry forward the latest text reply — the final one is what
    // the UI renders when stop_reason === end_turn.
    if (textBlocks.length > 0) {
      finalText = textBlocks.map((b) => b.text).join("\n\n");
    }

    if (result.stopReason === "end_turn" || toolUses.length === 0) {
      return { text: finalText, costCents: totalCostCents, turns: turn };
    }

    if (result.stopReason !== "tool_use") {
      throw new RuntimeError(
        `Unexpected stop reason: ${result.stopReason}`,
        "llm_failed",
      );
    }

    // Execute each tool call and append tool_result blocks.
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];

    for (const use of toolUses) {
      const impl = anthropicNameToImpl.get(use.name);
      if (!impl) {
        appendEvent(runId, "tool_call", {
          turn,
          toolName: use.name,
          status: "rejected_unknown",
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `Tool '${use.name}' is not available to you.`,
          is_error: true,
        });
        continue;
      }
      // Trust-mode gate — mutating tools only fire in autopilot in 2.2a.
      if (impl.isMutating && agent.trustMode !== "autopilot") {
        throw new RuntimeError(
          `Tool '${impl.id}' mutates state; trust mode '${agent.trustMode}' requires an approval flow (Phase 2.3).`,
          "approval_required",
        );
      }

      const parsed = impl.inputSchema.safeParse(use.input);
      if (!parsed.success || parsed.data === undefined) {
        const msg = parsed.error?.message ?? "input validation failed";
        appendEvent(runId, "tool_call", {
          turn,
          toolId: impl.id,
          status: "input_invalid",
          message: msg,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `Input validation failed: ${msg}. Please retry with valid input.`,
          is_error: true,
        });
        continue;
      }

      appendEvent(runId, "tool_call", {
        turn,
        toolId: impl.id,
        input: parsed.data as unknown as Record<string, unknown>,
      });

      try {
        const ctx: ToolContext = {
          agent,
          runId,
          tenantId,
        };
        const out = await impl.execute(parsed.data, ctx);
        const serialised = truncate(JSON.stringify(out), MAX_TOOL_RESULT_CHARS);
        appendEvent(runId, "tool_result", {
          turn,
          toolId: impl.id,
          status: "ok",
          resultChars: serialised.length,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: serialised,
        });
      } catch (err) {
        const msg =
          err instanceof ToolExecutionError ? err.message : sanitiseError(err);
        appendEvent(runId, "tool_result", {
          turn,
          toolId: impl.id,
          status: "error",
          message: msg,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `Tool call failed: ${msg}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new RuntimeError(
    `Run exceeded ${MAX_TURNS} LLM turns — aborting to prevent runaway loops.`,
    "too_many_turns",
  );
}

function selectToolsForAgent(agent: Agent): ToolImpl[] {
  const allowlist = new Set(agent.toolAllowlist);
  // Filter happens in CODE, before any LLM call. Even if the LLM later
  // invokes a tool outside the allowlist, tool-registry lookup gates it again.
  return allToolImpls().filter((t) => allowlist.has(t.id));
}

function buildSystemPrompt(agent: Agent): string {
  const rules = agent.rules.trim();
  const parts = [
    agent.personality.trim(),
    rules ? `# Rules (hard guardrails — never cross these)\n${rules}` : "",
    `# Operating context`,
    `You are ${agent.name}, operating on behalf of the Jacarenda Labs account.`,
    agent.trustMode === "draft"
      ? "You are in DRAFT mode — your output is a draft for human review, nothing ships without approval."
      : agent.trustMode === "ask"
        ? "You are in ASK mode — propose concrete actions, but always ask before anything leaves the building."
        : "You are in AUTOPILOT mode — act decisively on behalf of the account, but stay inside your rules.",
  ].filter(Boolean);
  return parts.join("\n\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let to: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        to = setTimeout(
          () => reject(new RuntimeError(message, "llm_failed")),
          ms,
        );
      }),
    ]);
  } finally {
    if (to) clearTimeout(to);
  }
}

function sanitiseError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unknown error";
  return raw.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").slice(0, 300);
}
