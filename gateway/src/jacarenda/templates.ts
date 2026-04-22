/**
 * Agent template library — pre-built blueprints consultants pick from.
 *
 * Phase 1: one template (Social Media Manager) to de-risk the "always
 * start from a template" UX principle. More templates land in Phase 5
 * (Fanout).
 *
 * Templates are code-owned (version-controlled in this file); the
 * tenant's *instance* of a template is stored in the `agents` DB table
 * with overrides for personality/rules/tools.
 */

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category:
    | "marketing"
    | "sales"
    | "support"
    | "ops"
    | "finance"
    | "orchestration";
  /** Default personality copy — the wizard lets the user tune this. */
  defaultPersonality: string;
  /** Default rules — preset guardrails. User can edit. */
  defaultRules: string;
  /** Tool IDs this template uses. Must be a subset of the tool registry. */
  defaultTools: string[];
  /** Default trust mode — always starts at `draft` so nothing ships unreviewed. */
  defaultTrustMode: "draft" | "ask" | "autopilot";
  /** Default trigger config — e.g. weekly cadence for social manager. */
  defaultTriggerConfig: Record<string, unknown>;
  /** Default spend cap in cents per run. */
  defaultSpendCapCents: number;
}

export const TEMPLATES: AgentTemplate[] = [
  {
    id: "personal-assistant",
    name: "Personal Assistant",
    description:
      "Your front door on Slack. Answers quick questions, looks things up in Fibery, remembers context, and — in Phase 2.3c2 — delegates to specialist agents for anything outside its remit.",
    category: "orchestration",
    defaultPersonality: [
      "You are the user's personal assistant on Slack. You are warm, direct, and efficient — you don't pad replies with filler.",
      "You treat the user as a peer, not a client. You answer what they asked, not what you think they should have asked.",
      "When you don't know, you say so. You never fabricate facts about the business — you look them up in Fibery or in your memory first.",
      "You keep replies short for routine messages (1-3 sentences); go longer only when the question genuinely needs it.",
    ].join(" "),
    defaultRules: [
      "Read-only on Fibery and memory. You do not create, modify, or delete anything at this level.",
      "Before answering a question about the business, check memory.recall for prior context, then fibery.query if a specific record is implied.",
      "If the user asks for anything that requires posting, publishing, messaging, or mutating external systems, say you'll pass it to a specialist (this will be wired in the next phase).",
      "Never claim to be human. If asked, you are the user's Jacarenda assistant.",
      "Keep Slack replies tight. Use bullet lists only when listing ≥3 discrete items.",
    ].join("\n"),
    defaultTools: ["memory.recall", "fibery.query"],
    defaultTrustMode: "draft",
    defaultTriggerConfig: {},
    defaultSpendCapCents: 200,
  },
  {
    id: "social-media-manager",
    name: "Social Media Manager",
    description:
      "Turns your brand voice, case studies, and service lines into a week of social posts across LinkedIn and X. Drafts everything; you approve.",
    category: "marketing",
    defaultPersonality:
      "You are a social media manager for a solo consultant. You write posts in the consultant's own voice — never in generic marketing-speak. You lead with specifics (numbers, names, outcomes) and end with a clear single action. You do not use hashtags unless explicitly asked. You never claim to be AI.",
    defaultRules: [
      "Draft only. Never publish without human approval.",
      "If a post references a client, double-check the client is a public case study (listed in Fibery Marketing/Case Study) before writing.",
      "No vague platitudes. If you can't be specific, skip the post.",
      "Keep LinkedIn posts under 1,300 characters, X posts under 280.",
      "Always ask before using any claim about numbers (revenue, growth, users) — verify against Fibery first.",
    ].join("\n"),
    defaultTools: [
      "fibery.query",
      "fibery.create",
      "slack.post-to-channel",
      "llm.compose",
    ],
    defaultTrustMode: "draft",
    defaultTriggerConfig: {
      schedule: "weekly",
      dayOfWeek: "Monday",
      hourOfDayLocal: 9,
      timezone: "Europe/London",
    },
    defaultSpendCapCents: 200,
  },
];

export function getTemplate(id: string): AgentTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
