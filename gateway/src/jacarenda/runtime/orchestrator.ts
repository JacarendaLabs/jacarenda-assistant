/**
 * Agent orchestrator — multi-turn runs with tool support + pause/resume
 * for human approval (Phase 2.3a).
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
 *  - Trust-mode gate: mutating tool in non-autopilot → run is PAUSED
 *    (not hard-failed); approval row is written and loop state
 *    persisted. On approve the paused tool executes; on reject a
 *    rejection tool_result is added and the loop continues so the
 *    LLM can decide what to do next.
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
  getRun,
  loadPauseState,
  markRunRunning,
  pauseRun,
  startRun,
  type RunRow,
  type TriggeredBy,
} from "./run-store.js";
import {
  createApproval,
  getApproval,
  type DecisionKind,
} from "../approval-store.js";
import { allToolImpls } from "./tool-registry.js";
import {
  ToolExecutionError,
  type ToolContext,
  type ToolImpl,
} from "./tool-context.js";
import { dispatchApprovalToSlack } from "./slack-approval-dispatcher.js";

const JACARENDA_PUBLIC_BASE_URL =
  process.env.JACARENDA_PUBLIC_BASE_URL ??
  "https://assistant.jacarendalabs.com";

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

export type RunAgentOutcome =
  | { kind: "done"; run: RunRow; responseText: string }
  | {
      kind: "needs_approval";
      run: RunRow;
      approvalId: string;
      question: string;
      proposedAction: { toolId: string; input: Record<string, unknown> };
    };

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "agent_not_found"
      | "input_too_long"
      | "agent_not_runnable"
      | "llm_failed"
      | "tool_failed"
      | "run_not_paused"
      | "approval_mismatch"
      | "too_many_turns"
      | "internal",
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

/* --------------------------------------------------------- public entrypoints */

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutcome> {
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

  const initialMessages: LlmMessage[] = [
    { role: "user", content: input.userInput },
  ];

  return driveLoop({
    run,
    agent,
    tenantId,
    messages: initialMessages,
    startTurn: 1,
    carriedCost: 0,
  });
}

/**
 * Resume a paused run after a human approval decision.
 * Loads the persisted loop state, applies the decision as a
 * tool_result on the paused tool_use, and continues the loop.
 */
export async function resumeAgent(
  runId: string,
  decision: DecisionKind,
  decidedBy: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<RunAgentOutcome> {
  const run = getRun(runId, tenantId);
  if (!run) {
    throw new RuntimeError("Run not found.", "agent_not_found");
  }
  if (run.status !== "needs_approval") {
    throw new RuntimeError(
      `Run is not paused (status=${run.status}).`,
      "run_not_paused",
    );
  }
  const state = loadPauseState<PauseState>(runId);
  if (!state) {
    throw new RuntimeError(
      "Paused run state is missing or unreadable.",
      "run_not_paused",
    );
  }
  const agent = getAgent(run.agentId, tenantId);
  if (!agent) {
    throw new RuntimeError(
      "Agent for paused run no longer exists.",
      "agent_not_found",
    );
  }

  appendEvent(runId, "approval_resolved", {
    decision,
    decidedBy,
    toolId: state.pendingToolImplId,
  });

  // Rebuild the messages history, then either execute the pending tool
  // (approved) or inject a rejection tool_result (rejected) and let the
  // loop continue — the LLM decides how to handle the rejection.
  const messages: LlmMessage[] = state.messages;

  const toolResults: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }> = [...state.priorToolResults];

  if (decision === "rejected") {
    toolResults.push({
      type: "tool_result",
      tool_use_id: state.pendingToolUseId,
      content: "The human reviewer rejected this action. Do not retry it.",
      is_error: true,
    });
  } else {
    // Approved — execute the paused tool now.
    const impl = allToolImpls().find((t) => t.id === state.pendingToolImplId);
    if (!impl) {
      throw new RuntimeError(
        `Paused tool '${state.pendingToolImplId}' is no longer registered.`,
        "internal",
      );
    }
    try {
      const ctx: ToolContext = { agent, runId, tenantId };
      appendEvent(runId, "tool_call", {
        turn: state.turn,
        toolId: impl.id,
        input: state.pendingToolInput,
        viaApproval: true,
      });
      const out = await impl.execute(
        state.pendingToolInput as unknown as never,
        ctx,
      );
      const serialised = truncate(JSON.stringify(out), MAX_TOOL_RESULT_CHARS);
      appendEvent(runId, "tool_result", {
        turn: state.turn,
        toolId: impl.id,
        status: "ok",
        resultChars: serialised.length,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: state.pendingToolUseId,
        content: serialised,
      });
    } catch (err) {
      const msg =
        err instanceof ToolExecutionError ? err.message : sanitiseError(err);
      appendEvent(runId, "tool_result", {
        turn: state.turn,
        toolId: impl.id,
        status: "error",
        message: msg,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: state.pendingToolUseId,
        content: `Tool call failed: ${msg}`,
        is_error: true,
      });
    }
  }

  messages.push({ role: "user", content: toolResults });
  markRunRunning(runId);

  return driveLoop({
    run,
    agent,
    tenantId,
    messages,
    startTurn: state.turn + 1,
    carriedCost: state.totalCostCents,
  });
}

/* ------------------------------------------------------------ shared driver */

interface DriveLoopInput {
  run: RunRow;
  agent: Agent;
  tenantId: string;
  messages: LlmMessage[];
  startTurn: number;
  carriedCost: number;
}

interface PauseState {
  messages: LlmMessage[];
  turn: number;
  totalCostCents: number;
  pendingToolUseId: string;
  pendingToolImplId: string;
  pendingToolInput: Record<string, unknown>;
  priorToolResults: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }>;
  finalText: string;
}

async function driveLoop(input: DriveLoopInput): Promise<RunAgentOutcome> {
  const { run, agent, tenantId } = input;
  const messages = input.messages;

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

  let totalCostCents = input.carriedCost;
  let finalText = "";

  try {
    for (let turn = input.startTurn; turn <= MAX_TURNS; turn++) {
      appendEvent(run.id, "llm_call", {
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

      appendEvent(run.id, "llm_response", {
        turn,
        stopReason: result.stopReason,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costCents,
        blockCount: result.content.length,
      });

      messages.push({ role: "assistant", content: result.content });

      const toolUses = result.content.filter(
        (b): b is Extract<typeof b, { type: "tool_use" }> =>
          b.type === "tool_use",
      );
      const textBlocks = result.content.filter(
        (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
      );
      if (textBlocks.length > 0) {
        finalText = textBlocks.map((b) => b.text).join("\n\n");
      }

      if (result.stopReason === "end_turn" || toolUses.length === 0) {
        return finaliseDone({
          run,
          text: finalText,
          costCents: totalCostCents,
          turns: turn,
        });
      }

      if (result.stopReason !== "tool_use") {
        throw new RuntimeError(
          `Unexpected stop reason: ${result.stopReason}`,
          "llm_failed",
        );
      }

      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }> = [];

      for (const use of toolUses) {
        const impl = anthropicNameToImpl.get(use.name);
        if (!impl) {
          appendEvent(run.id, "tool_call", {
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

        const parsed = impl.inputSchema.safeParse(use.input);
        if (!parsed.success || parsed.data === undefined) {
          const msg = parsed.error?.message ?? "input validation failed";
          appendEvent(run.id, "tool_call", {
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

        // Trust-mode gate — mutating tools pause the run for approval
        // in draft/ask modes.
        if (impl.isMutating && agent.trustMode !== "autopilot") {
          const approval = createApproval({
            runId: run.id,
            tenantId,
            channel: "admin_ui",
            question: approvalQuestion(agent, impl, parsed.data),
            proposedAction: {
              toolId: impl.id,
              input: parsed.data as unknown as Record<string, unknown>,
            },
          });
          appendEvent(run.id, "approval_required", {
            turn,
            toolId: impl.id,
            approvalId: approval.id,
            channel: approval.channel,
          });

          // Outbound Slack notification (Phase 2.3b1). Non-fatal —
          // run stays paused regardless; we just lose the push if Slack
          // is down or the channel isn't configured.
          //
          // Fire-and-log: we await dispatch (so the returned 202 reflects
          // whether Slack got the message) but don't throw on failure.
          const dispatch = await dispatchApprovalToSlack({
            agent,
            approvalId: approval.id,
            question: approval.question,
            proposedAction: {
              toolId: impl.id,
              input: parsed.data as unknown as Record<string, unknown>,
            },
            publicBaseUrl: JACARENDA_PUBLIC_BASE_URL,
          });
          if (dispatch.dispatched) {
            appendEvent(run.id, "info", {
              kind: "approval_notified",
              via: "slack",
              slackTs: dispatch.slackTs,
            });
          } else if (dispatch.skipReason !== "channel_not_configured") {
            // Only noisy when a config IS present but dispatch failed.
            // 'not configured' is the expected no-op state.
            appendEvent(run.id, "info", {
              kind: "approval_notify_failed",
              skipReason: dispatch.skipReason,
              error: dispatch.error,
            });
          }
          const pauseState: PauseState = {
            messages,
            turn,
            totalCostCents,
            pendingToolUseId: use.id,
            pendingToolImplId: impl.id,
            pendingToolInput: parsed.data as unknown as Record<string, unknown>,
            priorToolResults: toolResults,
            finalText,
          };
          const paused = pauseRun({
            runId: run.id,
            pauseStateJson: JSON.stringify(pauseState),
            summary: `Awaiting approval: ${approval.question}`,
          });
          return {
            kind: "needs_approval",
            run: paused ?? run,
            approvalId: approval.id,
            question: approval.question,
            proposedAction: {
              toolId: impl.id,
              input: parsed.data as unknown as Record<string, unknown>,
            },
          };
        }

        appendEvent(run.id, "tool_call", {
          turn,
          toolId: impl.id,
          input: parsed.data as unknown as Record<string, unknown>,
        });

        try {
          const ctx: ToolContext = { agent, runId: run.id, tenantId };
          const out = await impl.execute(parsed.data, ctx);
          const serialised = truncate(
            JSON.stringify(out),
            MAX_TOOL_RESULT_CHARS,
          );
          appendEvent(run.id, "tool_result", {
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
            err instanceof ToolExecutionError
              ? err.message
              : sanitiseError(err);
          appendEvent(run.id, "tool_result", {
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
      totalCostCents: totalCostCents,
      summary: runtimeErr.message,
    });
    throw runtimeErr;
  }
}

function finaliseDone(opts: {
  run: RunRow;
  text: string;
  costCents: number;
  turns: number;
}): RunAgentOutcome {
  const summary = truncate(opts.text, 500);
  appendEvent(opts.run.id, "run_completed", {
    totalCostCents: opts.costCents,
    turns: opts.turns,
    summary,
  });
  const finished = finishRun({
    runId: opts.run.id,
    status: "succeeded",
    totalCostCents: opts.costCents,
    summary,
  });
  return {
    kind: "done",
    run: finished ?? { ...opts.run, status: "succeeded", summary },
    responseText: opts.text,
  };
}

/**
 * Compose the plain-English question shown in the approval queue.
 * Kept deliberately short — the UI layer adds agent + run metadata.
 */
function approvalQuestion(
  agent: Agent,
  impl: ToolImpl,
  input: unknown,
): string {
  if (impl.id === "fibery.create") {
    const i = input as { type?: string; name?: string };
    return `${agent.name} wants to create a ${i.type ?? "?"} entity named "${i.name ?? "?"}".`;
  }
  if (impl.id === "slack.post-to-channel") {
    const i = input as { channelId?: string };
    return `${agent.name} wants to post in Slack channel ${i.channelId ?? "?"}.`;
  }
  if (impl.id === "slack.dm") {
    const i = input as { userId?: string };
    return `${agent.name} wants to DM Slack user ${i.userId ?? "?"}.`;
  }
  return `${agent.name} wants to run tool '${impl.id}'.`;
}

/* --------------------------------------------------------------- internals */

function selectToolsForAgent(agent: Agent): ToolImpl[] {
  const allowlist = new Set(agent.toolAllowlist);
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

// Unused, but re-exported so a future approval-ownership check can load
// by id without another approval-store import hop.
export { getApproval };
