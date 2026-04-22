/**
 * Slack outbound approval notification (Phase 2.3b1 / 2.3b2).
 *
 * When a run pauses for human approval, we post a Block Kit message to
 * the configured approvals channel. Phase 2.3b2 adds inline
 * Approve / Reject buttons — the block_actions payloads they emit are
 * handled in `slack-approval-interactivity.ts` (Socket Mode, so no
 * signing-secret webhook is needed).
 *
 * Design notes:
 *  - Dispatch is non-fatal. If Slack is down, the token isn't set,
 *    or the channel id is missing, the run STAYS PAUSED — nothing
 *    ships without the approval landing in the admin UI. We just lose
 *    the push notification.
 *  - Credential isolation: bot token resolved via
 *    readCredential(credentialKey('slack_channel','bot_token')) — same
 *    path slack.post-to-channel uses. See docs/RUNTIME_SECURITY.md §1.
 *  - Channel configuration: `JACARENDA_SLACK_APPROVALS_CHANNEL` env var
 *    for MVP (single global channel for all Jacarenda Labs agents).
 *    Per-agent channel routing lands with channel-first ops in Phase 4.
 *  - Button action_ids (`APPROVAL_ACTION_APPROVE` / `..._REJECT`) and the
 *    `value` field (approval id) are the load-bearing contract with the
 *    interactivity handler. Changing them breaks in-flight approvals —
 *    add new action_ids if you need to evolve the shape.
 */

import type { Agent } from "../agent-store.js";
import { getSlackBotToken } from "./slack-credentials.js";

export const APPROVAL_ACTION_APPROVE = "jacarenda_approval_approve";
export const APPROVAL_ACTION_REJECT = "jacarenda_approval_reject";

export interface DispatchApprovalInput {
  agent: Agent;
  approvalId: string;
  question: string;
  proposedAction: { toolId: string; input: Record<string, unknown> };
  publicBaseUrl: string;
  /**
   * When set (format `<channelId>:<threadTs>`), post the approval card
   * as a reply in that thread instead of the global approvals channel.
   * Phase 2.3c1 — the PA routes approvals back into the originating
   * Slack conversation so the operator decides in-context.
   */
  slackThreadTs?: string;
}

export interface DispatchResult {
  dispatched: boolean;
  skipReason?: "channel_not_configured" | "token_missing" | "slack_error";
  slackTs?: string;
  error?: string;
}

const SLACK_TIMEOUT_MS = 10_000;

export async function dispatchApprovalToSlack(
  input: DispatchApprovalInput,
): Promise<DispatchResult> {
  // Prefer the originating Slack thread when the run was triggered
  // from one — approvals post inline with the conversation. Fall back
  // to the global approvals channel otherwise.
  const thread = parseThreadRef(input.slackThreadTs);
  const globalChannelId = process.env.JACARENDA_SLACK_APPROVALS_CHANNEL?.trim();
  const channelId = thread?.channelId ?? globalChannelId;
  const threadTs = thread?.threadTs;

  if (!channelId) {
    return { dispatched: false, skipReason: "channel_not_configured" };
  }

  const token = await getSlackBotToken();
  if (!token) {
    return { dispatched: false, skipReason: "token_missing" };
  }

  const approvalUrl = `${input.publicBaseUrl.replace(/\/$/, "")}/admin`;
  const blocks = buildApprovalBlocks({
    agentName: input.agent.name,
    question: input.question,
    toolId: input.proposedAction.toolId,
    proposedInput: input.proposedAction.input,
    approvalUrl,
    approvalId: input.approvalId,
  });

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        text: `${input.agent.name} needs your sign-off: ${input.question}`,
        blocks,
        unfurl_links: false,
        unfurl_media: false,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      dispatched: false,
      skipReason: "slack_error",
      error: msg
        .replace(/xox[abps]-[A-Za-z0-9-]{10,}/g, "[redacted]")
        .slice(0, 200),
    };
  } finally {
    clearTimeout(to);
  }

  if (!res.ok) {
    return {
      dispatched: false,
      skipReason: "slack_error",
      error: `Slack returned HTTP ${res.status}`,
    };
  }

  let parsed: { ok?: boolean; ts?: string; error?: string };
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    return {
      dispatched: false,
      skipReason: "slack_error",
      error: "non-JSON response from Slack",
    };
  }

  if (!parsed.ok) {
    return {
      dispatched: false,
      skipReason: "slack_error",
      error: `Slack API error: ${parsed.error ?? "unknown"}`,
    };
  }

  return { dispatched: true, slackTs: parsed.ts };
}

interface BuildBlocksInput {
  agentName: string;
  question: string;
  toolId: string;
  proposedInput: Record<string, unknown>;
  approvalUrl: string;
  approvalId: string;
}

function buildApprovalBlocks(input: BuildBlocksInput): unknown[] {
  const summary = summariseProposedInput(input.toolId, input.proposedInput);
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Approval needed",
        emoji: false,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${escapeMrkdwn(input.agentName)}* wants to run *${escapeMrkdwn(input.toolId)}*.\n\n${escapeMrkdwn(input.question)}`,
      },
    },
    ...(summary
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*What it proposes:*\n${summary}`,
            },
          },
        ]
      : []),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: APPROVAL_ACTION_APPROVE,
          text: { type: "plain_text", text: "Approve", emoji: false },
          value: input.approvalId,
          style: "primary",
        },
        {
          type: "button",
          action_id: APPROVAL_ACTION_REJECT,
          text: { type: "plain_text", text: "Reject", emoji: false },
          value: input.approvalId,
          style: "danger",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open admin UI", emoji: false },
          url: input.approvalUrl,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Approval id \`${truncate(input.approvalId, 8)}…\` · decide here or in the admin UI`,
        },
      ],
    },
  ];
}

/**
 * Split a `<channelId>:<threadTs>` ref into its parts. Returns null
 * when the ref is missing or malformed — the caller should fall back to
 * the global approvals channel in that case.
 */
function parseThreadRef(
  ref: string | undefined,
): { channelId: string; threadTs: string } | null {
  if (!ref) return null;
  const idx = ref.indexOf(":");
  if (idx <= 0 || idx >= ref.length - 1) return null;
  return {
    channelId: ref.slice(0, idx),
    threadTs: ref.slice(idx + 1),
  };
}

/**
 * Short human-readable summary of the proposed input. Never dumps raw
 * JSON into Slack — keeps the message tight and avoids leaking fields
 * that shouldn't be visible in the approvals channel.
 */
function summariseProposedInput(
  toolId: string,
  input: Record<string, unknown>,
): string | null {
  if (toolId === "fibery.create") {
    const type = String(input["type"] ?? "?");
    const name = String(input["name"] ?? "?");
    return `Create \`${escapeMrkdwn(type)}\` entity named "${escapeMrkdwn(name)}"`;
  }
  if (toolId === "slack.post-to-channel") {
    const channel = String(input["channelId"] ?? "?");
    return `Post to Slack channel \`${escapeMrkdwn(channel)}\``;
  }
  if (toolId === "slack.dm") {
    const user = String(input["userId"] ?? "?");
    return `DM Slack user \`${escapeMrkdwn(user)}\``;
  }
  return null;
}

function escapeMrkdwn(s: string): string {
  // Slack's mrkdwn escape: &, <, > only. Everything else is fine.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n);
}
