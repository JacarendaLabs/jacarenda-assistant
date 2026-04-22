export interface Agent {
  id: string;
  tenantId: string;
  templateId: string;
  name: string;
  description: string;
  personality: string;
  rules: string;
  toolAllowlist: string[];
  trustMode: "draft" | "ask" | "autopilot";
  triggerConfig: Record<string, unknown>;
  spendCapCents: number;
  status: "active" | "paused" | "archived";
  createdAt: number;
  updatedAt: number;
}
