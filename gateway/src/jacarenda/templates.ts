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
  category: "marketing" | "sales" | "support" | "ops" | "finance";
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
