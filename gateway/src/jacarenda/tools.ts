/**
 * Tool registry — the catalogue of actions agents can be granted.
 *
 * Phase 1: the registry is a code-owned JSON catalogue. The admin UI
 * shows each tool's id, label, description, and which template(s) use
 * it by default. Phase 2 wires the runtime (scoped allowlist per agent).
 *
 * Tool IDs use a `<provider>.<action>` naming convention. Keep them
 * stable — agents store them in `tool_allowlist_json`.
 */

export interface ToolSpec {
  id: string;
  label: string;
  description: string;
  // Plain-English sentence explaining what the agent can do with this tool.
  // Used in the wizard's "What it can do" step so consultants understand
  // the trust they're granting.
  plainEnglish: string;
  category: "data" | "messaging" | "llm" | "automation";
  /** Higher = higher risk; surface a warning in the wizard. */
  riskTier: 1 | 2 | 3;
}

export const TOOLS: ToolSpec[] = [
  {
    id: "fibery.query",
    label: "Read from Fibery",
    description: "Query entities in your Fibery workspace.",
    plainEnglish:
      "Can read your brand, services, clients, campaigns and content from Fibery. Read-only — it cannot change anything.",
    category: "data",
    riskTier: 1,
  },
  {
    id: "fibery.create",
    label: "Write to Fibery",
    description: "Create or update entities in your Fibery workspace.",
    plainEnglish:
      "Can add new content drafts, case studies or notes to Fibery. Creates drafts — you can review before they go anywhere.",
    category: "data",
    riskTier: 2,
  },
  {
    id: "llm.compose",
    label: "Write with an LLM",
    description: "Generate prose using an LLM (Claude / GPT).",
    plainEnglish:
      "Can generate draft text — posts, emails, replies. This is what makes the agent 'think'.",
    category: "llm",
    riskTier: 1,
  },
  {
    id: "slack.post-to-channel",
    label: "Post to Slack",
    description: "Send a message to a Slack channel.",
    plainEnglish:
      "Can post into your Slack. Only the channels you've connected in Integrations.",
    category: "messaging",
    riskTier: 2,
  },
  {
    id: "slack.dm",
    label: "Send Slack DMs",
    description: "Send a direct message in Slack.",
    plainEnglish: "Can send you a direct message in Slack.",
    category: "messaging",
    riskTier: 2,
  },
  {
    id: "whatsapp.send",
    label: "Send WhatsApp",
    description: "Send a WhatsApp message.",
    plainEnglish:
      "Can send a WhatsApp message on your behalf. High-trust — typically needs approval.",
    category: "messaging",
    riskTier: 3,
  },
  {
    id: "email.send",
    label: "Send email",
    description: "Send email via the connected provider.",
    plainEnglish:
      "Can send email from your connected account. High-trust — typically needs approval.",
    category: "messaging",
    riskTier: 3,
  },
  {
    id: "memory.recall",
    label: "Recall memory",
    description: "Read-only lookup over the agent's memory notebook.",
    plainEnglish:
      "Can look up what the agent remembers about you, the business, and past conversations. Read-only — it cannot change or forget anything.",
    category: "data",
    riskTier: 1,
  },
];

export function getTool(id: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.id === id);
}
