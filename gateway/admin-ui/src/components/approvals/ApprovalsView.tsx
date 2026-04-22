import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  FileText,
  Hash,
  Inbox,
  Loader2,
  MessageSquare,
  User,
  X,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useStageAnimations } from "@/hooks/useStageAnimations";

interface Approval {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  agentTemplateId: string;
  channel: string;
  question: string;
  proposedAction?: {
    toolId?: string;
    input?: Record<string, unknown>;
  } & Record<string, unknown>;
  createdAt: number;
}

interface ApprovalsViewProps {
  onSignOut: () => void;
  onUnauthorized: () => void;
  onNavigateChannels: () => void;
  onNavigateAgents: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; approvals: Approval[] }
  | { kind: "error"; message: string };

export function ApprovalsView({
  onSignOut,
  onUnauthorized,
  onNavigateChannels,
  onNavigateAgents,
}: ApprovalsViewProps) {
  useStageAnimations();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    const { status, data } = await api<{ approvals: Approval[] }>(
      "GET",
      "/admin/api/jacarenda/approvals",
    );
    if (status === 401) {
      onUnauthorized();
      return;
    }
    if (status !== 200 || !data) {
      setState({
        kind: "error",
        message: `Couldn't load approvals (HTTP ${status}).`,
      });
      return;
    }
    setState({ kind: "ready", approvals: data.approvals });
  }, [onUnauthorized]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return (
    <div className="min-h-screen bg-white">
      <TopBar
        onSignOut={onSignOut}
        activeTab="approvals"
        onNavigateChannels={onNavigateChannels}
        onNavigateAgents={onNavigateAgents}
        onNavigateApprovals={() => {
          /* no-op — already here */
        }}
      />

      <main>
        <section className="pt-32 pb-10 bg-white">
          <div className="container mx-auto px-6 max-w-4xl">
            <div className="inline-flex items-center gap-2 bg-black/5 border border-gray-200 rounded-full px-3 py-1.5 mb-6 animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-black" />
              <span className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-black">
                Approvals
              </span>
            </div>
            <h1 className="font-inter text-4xl md:text-5xl font-bold text-black tracking-tight leading-[1.05]">
              Sign-off queue.
            </h1>
            <p className="text-lg md:text-xl text-gray-600 mt-4 max-w-2xl leading-relaxed">
              When your agents need your say-so — drafts to review, actions to
              confirm — they land here. Approving resumes the paused run from
              exactly where it stopped.
            </p>
          </div>
        </section>

        <section className="pb-24 pt-2 bg-white">
          <div className="container mx-auto px-6 max-w-4xl">
            {state.kind === "loading" && (
              <div className="py-16 text-center text-gray-500 text-sm">
                Loading…
              </div>
            )}

            {state.kind === "error" && (
              <div className="py-16 text-center">
                <p className="text-gray-900 font-medium">{state.message}</p>
              </div>
            )}

            {state.kind === "ready" && state.approvals.length === 0 && (
              <EmptyState />
            )}

            {state.kind === "ready" && state.approvals.length > 0 && (
              <div className="space-y-4">
                {state.approvals.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    onResolved={refresh}
                    onUnauthorized={onUnauthorized}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-16 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-xl bg-black flex items-center justify-center mb-6">
        <Inbox className="w-6 h-6 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-black mb-2">All clear.</h2>
      <p className="text-gray-600 max-w-md leading-relaxed">
        No pending approvals right now. When an agent has something for you to
        review, you&rsquo;ll see it here.
      </p>
    </div>
  );
}

type RowState =
  | { kind: "idle" }
  | { kind: "deciding"; decision: "approved" | "rejected" }
  | { kind: "error"; message: string };

function ApprovalCard({
  approval,
  onResolved,
  onUnauthorized,
}: {
  approval: Approval;
  onResolved: () => void;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<RowState>({ kind: "idle" });
  const [showRaw, setShowRaw] = useState(false);

  const decide = async (decision: "approved" | "rejected") => {
    setState({ kind: "deciding", decision });
    const { status, data } = await api<{ error?: string }>(
      "POST",
      `/admin/api/jacarenda/approvals/${approval.id}/decide`,
      { decision },
    );
    if (status === 401) {
      onUnauthorized();
      return;
    }
    if (status === 200 || status === 202) {
      onResolved();
      return;
    }
    setState({
      kind: "error",
      message: data?.error ?? `Couldn't record decision (HTTP ${status}).`,
    });
  };

  const toolId = (approval.proposedAction?.toolId as string | undefined) ?? "";
  const input =
    (approval.proposedAction?.input as Record<string, unknown> | undefined) ??
    {};
  const headline = toolHeadline(approval.agentName, toolId);

  return (
    <div className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300">
      {/* Header */}
      <div className="flex items-start gap-4 mb-5">
        <div className="w-11 h-11 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-sm font-medium text-black">
              {approval.agentName}
            </p>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] bg-gray-100 text-gray-700 border border-gray-200">
              {approval.channel === "admin_ui" ? "Admin UI" : approval.channel}
            </span>
          </div>
          <p className="text-lg font-semibold text-black leading-snug">
            {headline}
          </p>
        </div>
      </div>

      {/* Tool-specific preview */}
      <ProposedActionPreview toolId={toolId} input={input} />

      {/* Raw JSON toggle (for developers / unknown tools) */}
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="mt-4 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black transition-colors"
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform ${showRaw ? "rotate-180" : ""}`}
        />
        <span>{showRaw ? "Hide" : "Show"} raw action</span>
      </button>
      {showRaw && (
        <pre className="mt-2 p-3 rounded-lg bg-gray-50 border border-gray-100 text-[11px] text-gray-800 overflow-auto font-mono max-h-48">
          {JSON.stringify(approval.proposedAction, null, 2)}
        </pre>
      )}

      {/* Footer: timestamp + action buttons */}
      <div className="mt-6 pt-5 border-t border-gray-100 flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-gray-500">
          {new Date(approval.createdAt).toLocaleString()} · run{" "}
          <span className="font-mono">{approval.runId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-10 px-4 min-w-[110px] justify-center border-gray-300 text-black hover:bg-gray-100"
            onClick={() => decide("rejected")}
            disabled={state.kind === "deciding"}
          >
            {state.kind === "deciding" && state.decision === "rejected" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <X className="w-4 h-4" />
                <span>Reject</span>
              </>
            )}
          </Button>
          <Button
            className="bg-black hover:bg-gray-800 text-white h-10 px-4 min-w-[110px] justify-center"
            onClick={() => decide("approved")}
            disabled={state.kind === "deciding"}
          >
            {state.kind === "deciding" && state.decision === "approved" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Approve</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {state.kind === "error" && (
        <p className="mt-3 text-sm text-red-700">{state.message}</p>
      )}
    </div>
  );
}

/* ----------------------------------------------- tool-specific preview */

function toolHeadline(agentName: string, toolId: string): string {
  switch (toolId) {
    case "fibery.create":
      return `Save a draft to Fibery`;
    case "slack.post-to-channel":
      return `Post a message to Slack`;
    case "slack.dm":
      return `Send a Slack DM`;
    default:
      return `Run ${toolId || "a tool"}`;
  }
}

function ProposedActionPreview({
  toolId,
  input,
}: {
  toolId: string;
  input: Record<string, unknown>;
}) {
  if (toolId === "fibery.create") {
    return <FiberyCreatePreview input={input} />;
  }
  if (toolId === "slack.post-to-channel") {
    return <SlackPostPreview input={input} kind="channel" />;
  }
  if (toolId === "slack.dm") {
    return <SlackPostPreview input={input} kind="dm" />;
  }
  // Fallback for tools we don't have a custom preview for yet.
  return (
    <pre className="p-4 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-800 overflow-auto font-mono max-h-64">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

function FiberyCreatePreview({ input }: { input: Record<string, unknown> }) {
  const type = String(input["type"] ?? "");
  const name = String(input["name"] ?? "");
  const fields = (input["fields"] as Record<string, unknown> | undefined) ?? {};

  // Body (if present) gets the hero treatment; other fields as a small list.
  const body =
    typeof fields["Body"] === "string" ? (fields["Body"] as string) : "";
  const keyTakeaways =
    typeof fields["Key Takeaways"] === "string"
      ? (fields["Key Takeaways"] as string)
      : "";
  const otherFields = Object.entries(fields).filter(
    ([k]) => k !== "Body" && k !== "Key Takeaways",
  );

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden">
      {/* Meta row */}
      <div className="px-5 py-3 border-b border-gray-100 bg-white flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500">
            Fibery type
          </span>
          <span className="text-sm font-medium text-black">{type || "—"}</span>
        </div>
        {otherFields.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500">
              {k}
            </span>
            <span className="text-sm text-black">{String(v)}</span>
          </div>
        ))}
      </div>

      {/* Name */}
      <div className="px-5 pt-4">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-1">
          Name
        </p>
        <p className="text-base font-semibold text-black">{name || "—"}</p>
      </div>

      {/* Body */}
      {body && (
        <div className="px-5 pt-4 pb-5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-2">
            Body
          </p>
          <div className="p-4 rounded-lg bg-white border border-gray-100">
            <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
              {body}
            </p>
          </div>
        </div>
      )}

      {keyTakeaways && (
        <div className="px-5 pb-5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-2">
            Key takeaways
          </p>
          <div className="p-4 rounded-lg bg-white border border-gray-100">
            <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
              {keyTakeaways}
            </p>
          </div>
        </div>
      )}

      {!body && !keyTakeaways && <div className="pb-5" />}
    </div>
  );
}

function SlackPostPreview({
  input,
  kind,
}: {
  input: Record<string, unknown>;
  kind: "channel" | "dm";
}) {
  const target =
    kind === "channel"
      ? String(input["channelId"] ?? "")
      : String(input["userId"] ?? "");
  const text = String(input["text"] ?? "");

  const Icon = kind === "channel" ? Hash : User;
  const targetLabel = kind === "channel" ? "Channel" : "User";

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-white flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500" />
          <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500">
            {targetLabel}
          </span>
          <span className="text-sm font-mono text-black">{target || "—"}</span>
        </div>
      </div>

      <div className="p-5">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-2 flex items-center gap-1.5">
          <MessageSquare className="w-3 h-3" />
          <span>Message</span>
        </p>
        <div className="p-4 rounded-lg bg-white border border-gray-100">
          <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
            {text || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
