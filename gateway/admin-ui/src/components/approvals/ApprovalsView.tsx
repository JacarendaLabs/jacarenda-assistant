import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status, data } = await api<{ approvals: Approval[] }>(
        "GET",
        "/admin/api/jacarenda/approvals",
      );
      if (cancelled) return;
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
    })();
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

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
          <div className="container mx-auto px-6 max-w-5xl">
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
              confirm — they land here. Also mirrored to Slack and WhatsApp so
              you can decide on the go.
            </p>
          </div>
        </section>

        <section className="pb-24 pt-2 bg-white">
          <div className="container mx-auto px-6 max-w-5xl">
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
              <div className="space-y-3">
                {state.approvals.map((a) => (
                  <ApprovalRow key={a.id} approval={a} />
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
        review, you'll see it here — and get a ping in Slack/WhatsApp.
      </p>
    </div>
  );
}

function ApprovalRow({ approval }: { approval: Approval }) {
  return (
    <div className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm hover-lift transition-all duration-300">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <p className="text-sm font-medium text-black">
              {approval.agentName}
            </p>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] bg-gray-100 text-gray-700 border border-gray-200">
              via {approval.channel}
            </span>
          </div>
          <p className="text-gray-900 leading-relaxed">{approval.question}</p>
          <p className="text-xs text-gray-500 mt-2">
            {new Date(approval.createdAt).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
