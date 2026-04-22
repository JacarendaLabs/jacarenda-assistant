/**
 * Slack credential accessor for the agent runtime.
 *
 * Resolves the bot token via `readCredential(credentialKey('slack_channel',
 * 'bot_token'))` which is upstream's CES-first credential reader:
 *   1. CES HTTP API when CES_CREDENTIAL_URL is set (Docker mode — our
 *      production posture)
 *   2. Encrypted file fallback (~/.vellum/protected/keys.enc)
 *
 * Consumers MUST NOT read process.env directly for the Slack token —
 * this module is the single chokepoint so the CES-isolation contract in
 * RUNTIME_SECURITY.md §1 holds.
 *
 * No caching here. Agent runs are infrequent; a cold read per tool call
 * keeps the blast radius tight (no stale token sitting in memory on a
 * pod that's been idle for hours).
 */

import { credentialKey } from "../../credential-key.js";
import { readCredential } from "../../credential-reader.js";

export async function getSlackBotToken(): Promise<string | undefined> {
  return readCredential(credentialKey("slack_channel", "bot_token"));
}
