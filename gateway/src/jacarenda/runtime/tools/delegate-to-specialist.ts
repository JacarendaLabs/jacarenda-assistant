/**
 * delegate.to_specialist — Personal Assistant hands a sub-task to a
 * specialist agent (e.g. "ask the marketing agent to draft a tweet about
 * the 2.3c launch") and returns the specialist's final answer.
 *
 * Phase 2.3c2 — synchronous v0.5. The PA awaits the child run inline so
 * the specialist's output arrives back as the tool result and the PA can
 * synthesise a single in-thread reply for the user.
 *
 *   ┌───────────┐ delegate ┌────────────┐ result ┌───────────┐
 *   │   PA      │─────────▶│ Specialist │───────▶│   PA      │
 *   │ (run A)   │          │  (run B,   │        │ (resumes  │
 *   │           │          │  parent=A) │        │  loop)    │
 *   └───────────┘          └────────────┘        └───────────┘
 *
 * Async + Slack post-back is the planned 2.3c2.5 refinement; this v0.5
 * deliberately keeps the conversation as a single thread reply because
 * users prefer one synthesised answer over multiple thread bumps.
 *
 * Lineage: child runs are written with `parent_run_id = ctx.runId` so
 * the admin UI can render the PA → specialist tree.
 *
 * Recursion guard: a delegated run cannot itself delegate. If a
 * specialist agent's allowlist accidentally contains this tool, we
 * short-circuit at execute() with `delegation_not_permitted`.
 *
 * Tool isMutating: false. The tool itself doesn't side-effect — but the
 * specialist may call mutating tools, which gate at their own approval
 * boundary against the child run's threadTs (so approvals still surface
 * in the originating Slack thread).
 */

import { z } from "zod";

import { getAgent, listAgents, type Agent } from "../../agent-store.js";
import { runAgent, type RunAgentOutcome } from "../orchestrator.js";
import { getRun } from "../run-store.js";
import type { ToolImpl, ToolContext } from "../tool-context.js";
import { ToolExecutionError } from "../tool-context.js";

const inputSchema = z
  .object({
    specialistAgentId: z
      .string()
      .uuid()
      .describe(
        "ID of the specialist agent that should handle the sub-task. Use list_agents (or memory.recall) first if unsure.",
      ),
    task: z
      .string()
      .trim()
      .min(8)
      .max(2000)
      .describe(
        "What you want the specialist to do, in their voice — they will see this as the user prompt. Be specific; the specialist does not see this conversation's history.",
      ),
  })
  .strict();

type DelegateInput = z.infer<typeof inputSchema>;

export const delegateToSpecialistTool: ToolImpl<DelegateInput> = {
  id: "delegate.to_specialist",
  isMutating: false,
  inputSchema,
  description:
    "Hand a sub-task to a specialist agent (marketing, sales, etc.) and return their answer. The specialist runs as a child of your conversation — their tools, their guardrails, their trust mode — and surfaces their final response so you can use it in your reply to the user.",
  anthropicInputSchema: {
    type: "object",
    required: ["specialistAgentId", "task"],
    properties: {
      specialistAgentId: {
        type: "string",
        format: "uuid",
        description:
          "ID of the specialist agent to delegate to. Must be a different agent in the same tenant.",
      },
      task: {
        type: "string",
        minLength: 8,
        maxLength: 2000,
        description:
          "What you want the specialist to do, in their voice. They will see this as the user prompt and will not see this conversation's history.",
      },
    },
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<unknown> {
    // Recursion guard. If a specialist's allowlist accidentally permits
    // delegate.to_specialist, refuse — chains of delegations are not
    // supported until we add proper depth tracking + cycle detection.
    const callerRun = getRun(ctx.runId, ctx.tenantId);
    if (callerRun?.parentRunId) {
      throw new ToolExecutionError(
        "delegate.to_specialist cannot be called from a delegated run (no nested delegation in 2.3c2).",
        "upstream_failure",
      );
    }

    // Self-delegation is a footgun — the LLM might try to "delegate to
    // myself" to escape its own context. Refuse.
    if (input.specialistAgentId === ctx.agent.id) {
      throw new ToolExecutionError(
        "Cannot delegate to yourself.",
        "input_validation",
      );
    }

    const specialist = getAgent(input.specialistAgentId, ctx.tenantId);
    if (!specialist) {
      throw new ToolExecutionError(
        `Specialist agent ${input.specialistAgentId} not found in tenant.`,
        "input_validation",
      );
    }

    if (specialist.status !== "active") {
      throw new ToolExecutionError(
        `Specialist ${specialist.name} is currently ${specialist.status} — pick another or resume them first.`,
        "upstream_failure",
      );
    }

    // Run the specialist synchronously. Threading the parent's
    // slackThreadTs through means any approval the specialist needs
    // will route back to the same Slack thread the user started in.
    const outcome: RunAgentOutcome = await runAgent({
      agentId: specialist.id,
      tenantId: ctx.tenantId,
      userInput: input.task,
      triggeredBy: "delegated",
      triggeredByActor: ctx.agent.name,
      slackThreadTs: callerRun?.slackThreadTs ?? undefined,
      parentRunId: ctx.runId,
    });

    if (outcome.kind === "needs_approval") {
      // The specialist paused on its own approval gate. Tell the PA the
      // truth so it can explain to the user that something is in the
      // queue — don't pretend the work is done.
      return {
        kind: "specialist_needs_approval",
        specialistName: specialist.name,
        specialistRunId: outcome.run.id,
        approvalId: outcome.approvalId,
        question: outcome.question,
        proposedAction: outcome.proposedAction,
        message:
          `${specialist.name} drafted an action that needs your approval before it ships. ` +
          "Approve in Slack (same thread) or in the admin Approvals tab.",
      };
    }

    // outcome.kind === "done"
    return {
      kind: "specialist_responded",
      specialistName: specialist.name,
      specialistRunId: outcome.run.id,
      response: outcome.responseText,
    };
  },
};

/**
 * Helper used by orchestrator + admin UI to surface the list of agents a
 * caller can delegate to. Excludes the caller, agents in non-active status,
 * and the caller's own children (which can't accept further delegation).
 */
export function listDelegationTargets(
  caller: Agent,
  tenantId: string = caller.tenantId,
): Agent[] {
  return listAgents(tenantId).filter(
    (a) => a.id !== caller.id && a.status === "active",
  );
}
