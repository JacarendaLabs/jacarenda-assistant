/**
 * Slack inbound router — DM / @mention → Personal Assistant run (Phase 2.3c1).
 *
 * Socket Mode delivers a normalized inbound event for every user
 * message. When `JACARENDA_SLACK_DEFAULT_AGENT_ID` is set, this router
 * claims Slack messages for the Jacarenda Personal Assistant instead
 * of forwarding them to the upstream Vellum assistant daemon.
 *
 * Routing rules (MVP):
 *  - Only claims `sourceChannel === "slack"` events.
 *  - Only claims DMs (chatType `"im"`) and app mentions (content
 *    stripped of the leading `@bot` by the normalizer).
 *  - Skips edits, callback-action clicks, bot's own messages (already
 *    filtered upstream), and anything without an actor id.
 *
 * Reply flow:
 *  - Runs the PA via `runAgent()` with `triggeredBy: "channel"` and
 *    `slackThreadTs: "<channelId>:<threadOrMessageTs>"` so any
 *    approval the run creates routes back into this thread.
 *  - Posts the response as a threaded reply (using the triggering
 *    message's ts as the thread root if none exists yet).
 *  - On `needs_approval`: the dispatcher has already posted the
 *    approval card in the same thread — we add a short "I've queued
 *    this for approval" reply for user affordance.
 *
 * This module is deliberately standalone from the rest of the Slack
 * plumbing in `gateway/src/slack/` — we consume its normalized events
 * but do not import into or from it, keeping the fork boundary clean.
 */

import { getLogger } from "../../logger.js";
import type { NormalizedSlackEvent } from "../../slack/normalize.js";
import { findPersonalAssistant, getAgent } from "../agent-store.js";
import {
  runAgent,
  RuntimeError,
  type RunAgentOutcome,
} from "./orchestrator.js";
import { listRunsForSlackThread } from "./run-store.js";
import { getSlackBotToken } from "./slack-credentials.js";

const log = getLogger("jacarenda-slack-inbound");

const SLACK_POST_TIMEOUT_MS = 10_000;

/**
 * Resolve the Personal Assistant agent. Prefers the explicit
 * `JACARENDA_SLACK_DEFAULT_AGENT_ID` env var (useful for multi-PA
 * future tenants and for staging overrides), then falls back to the
 * tenant's canonical PA via template-id lookup.
 *
 * Returns null when neither path resolves — the router treats this as
 * passthrough so the upstream daemon keeps handling the event.
 */
function resolvePersonalAssistant() {
  const explicitId = process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID?.trim();
  if (explicitId) {
    const agent = getAgent(explicitId);
    if (agent) return agent;
    log.warn(
      { agentId: explicitId },
      "JACARENDA_SLACK_DEFAULT_AGENT_ID set but agent not found",
    );
    return null;
  }
  return findPersonalAssistant();
}

/**
 * Synchronous "should we claim this event?" check. Returns true for
 * DMs + @mentions when a PA agent exists and the event is NOT an edit
 * / callback click (those flow through to the upstream daemon). Safe
 * to call on every inbound event — falls back to passthrough if the
 * tenant doesn't have a PA seeded.
 */
export function shouldPersonalAssistantClaim(
  normalized: NormalizedSlackEvent,
): boolean {
  const event = normalized.event;
  if (event.sourceChannel !== "slack") return false;
  if (event.message.isEdit) return false;
  if (event.message.callbackData) return false;
  if (!event.actor.actorExternalId) return false;

  if (!isDirectMessageOrAppMention(event.raw, event.source.chatType)) {
    return false;
  }

  return resolvePersonalAssistant() !== null;
}

/**
 * Detect a DM or @mention from the raw Slack event payload. The
 * normalizer doesn't set `chatType: "im"` for DMs (it leaves chatType
 * unset), so we read the Slack-native signal from the raw event:
 *  - `raw.type === "app_mention"` → user @mentioned the bot
 *  - `raw.channel_type === "im"` → direct message channel
 *  - `raw.channel` starting with "D" → DM channel id (Slack convention,
 *    last-resort fallback if channel_type is missing)
 */
function isDirectMessageOrAppMention(
  raw: Record<string, unknown>,
  chatType: string | undefined,
): boolean {
  const rawType = typeof raw["type"] === "string" ? raw["type"] : undefined;
  if (rawType === "app_mention") return true;

  const rawChannelType =
    typeof raw["channel_type"] === "string" ? raw["channel_type"] : undefined;
  if (rawChannelType === "im") return true;

  const rawChannel =
    typeof raw["channel"] === "string" ? raw["channel"] : undefined;
  if (rawChannel?.startsWith("D")) return true;

  // Last-resort: the normalizer's own chatType, retained for symmetry
  // with future channels that might populate it.
  return chatType === "im";
}

/**
 * Drive a PA run for a claimed Slack event. Returns a Promise that
 * callers can fire-and-forget (awaiting is optional — all errors are
 * logged internally). The caller must have already verified
 * `shouldPersonalAssistantClaim` returned true.
 */
export async function runPersonalAssistantForSlackEvent(
  normalized: NormalizedSlackEvent,
): Promise<void> {
  const event = normalized.event;
  const agent = resolvePersonalAssistant();
  if (!agent) {
    log.warn(
      "No Personal Assistant agent resolved for tenant — dropping event",
    );
    return;
  }
  if (agent.status === "archived") {
    log.warn(
      { agentId: agent.id },
      "Personal Assistant is archived — dropping event",
    );
    return;
  }

  const userText = event.message.content.trim();
  if (!userText) {
    log.debug(
      { actorId: event.actor.actorExternalId },
      "Empty PA message — dropped",
    );
    return;
  }

  const threadTs = normalized.threadTs ?? event.source.messageId;
  const channelId = normalized.channel;
  if (!threadTs || !channelId) {
    log.warn(
      { channelId, threadTs },
      "Missing channel or thread ts — dropping PA event",
    );
    return;
  }

  const slackThreadTs = `${channelId}:${threadTs}`;
  const actorExternalId = event.actor.actorExternalId;

  // Thread continuity — if prior PA runs ran in this same thread, build
  // a compact "conversation so far" preamble so the agent has short-
  // term memory within the chat without needing a whole new
  // conversation-state model. Capped at 6 prior turns and 4000 chars.
  const preamble = buildThreadPreamble(slackThreadTs, agent.tenantId);
  const userInput = preamble ? `${preamble}\n\n${userText}` : userText;

  let outcome: RunAgentOutcome;
  try {
    outcome = await runAgent({
      agentId: agent.id,
      userInput,
      triggeredBy: "channel",
      triggeredByActor: `slack:${actorExternalId}`,
      slackThreadTs,
    });
  } catch (err) {
    if (err instanceof RuntimeError) {
      log.warn(
        { code: err.code, agentId: agent.id, actorExternalId },
        "PA run failed with RuntimeError",
      );
      await postReply(
        channelId,
        threadTs,
        "Sorry — I hit an error handling that. Try again in a moment.",
      );
      return;
    }
    log.error({ err, agentId: agent.id }, "PA run threw");
    await postReply(
      channelId,
      threadTs,
      "Sorry — something unexpected went wrong. I've logged it.",
    );
    return;
  }

  if (outcome.kind === "done") {
    await postReply(channelId, threadTs, outcome.responseText || "(no reply)");
    return;
  }

  // needs_approval — the dispatcher already posted the Block Kit card
  // in this thread. Add a short user-facing affordance so the operator
  // sees the PA acknowledging the pause.
  await postReply(
    channelId,
    threadTs,
    "I've queued that for your approval — check the card above.",
  );
}

const MAX_THREAD_PREAMBLE_TURNS = 6;
const MAX_THREAD_PREAMBLE_CHARS = 4000;

/**
 * Build a short "what I've already said in this thread" block from
 * prior runs' summaries. Returns null when there is no prior context.
 *
 * Stateless-continuity approach: rather than building a live
 * conversation-state model (deferred to 2.3c3), each run re-reads a
 * bounded window of prior runs in the same thread at kickoff. Keeps
 * the audit trail clean (every message = one run with its own events)
 * while giving the agent enough short-term memory to hold a chat.
 *
 * We surface the PA's prior REPLIES only — user text isn't captured in
 * the event log, and prior replies alone are usually enough for
 * common continuity queries ("what did you say earlier about…"). The
 * user's new message is already passed as `userInput`.
 */
function buildThreadPreamble(
  slackThreadTs: string,
  tenantId: string,
): string | null {
  const runs = listRunsForSlackThread(
    slackThreadTs,
    tenantId,
    MAX_THREAD_PREAMBLE_TURNS,
  );
  if (runs.length === 0) return null;

  // Oldest → newest so the preamble reads chronologically.
  const chronological = [...runs].reverse();
  const lines: string[] = [];

  for (const run of chronological) {
    const summary = run.summary?.trim();
    if (summary) lines.push(`- ${collapseWhitespace(summary)}`);
  }

  if (lines.length === 0) return null;

  const body = [
    "What you said earlier in this Slack thread (oldest first):",
    ...lines,
  ].join("\n");

  if (body.length <= MAX_THREAD_PREAMBLE_CHARS) return body;
  // Truncate from the START — keep the most recent exchange
  return `…(earlier truncated)…\n${body.slice(-MAX_THREAD_PREAMBLE_CHARS)}`;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function postReply(
  channelId: string,
  threadTs: string,
  text: string,
): Promise<void> {
  const token = await getSlackBotToken();
  if (!token) {
    log.warn("Slack bot token unavailable — skipping PA reply");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_POST_TIMEOUT_MS);

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs,
        text,
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn(
        { status: res.status, channelId, threadTs },
        "PA reply returned non-2xx",
      );
      return;
    }
    const parsed = (await res.json()) as { ok?: boolean; error?: string };
    if (!parsed.ok) {
      log.warn(
        { slackError: parsed.error, channelId, threadTs },
        "PA reply returned ok=false",
      );
    }
  } catch (err) {
    log.warn({ err, channelId, threadTs }, "PA reply fetch failed");
  } finally {
    clearTimeout(timer);
  }
}
