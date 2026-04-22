import { useState } from "react";
import { Clock, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { Agent } from "@/components/agents/types";

interface TestDriveSectionProps {
  agent: Agent;
  onUnauthorized: () => void;
  onNavigateApprovals?: () => void;
}

interface RunRow {
  id: string;
  status: "running" | "succeeded" | "failed" | "needs_approval" | "cancelled";
  totalCostCents: number;
}

interface RunResponse {
  kind: "done" | "needs_approval";
  run: RunRow;
  response?: string;
  approvalId?: string;
  question?: string;
  proposedAction?: Record<string, unknown>;
}

type ViewState =
  | { kind: "idle" }
  | { kind: "running" }
  | {
      kind: "result";
      response: string;
      run: RunRow;
    }
  | {
      kind: "awaiting_approval";
      run: RunRow;
      approvalId: string;
      question: string;
    }
  | { kind: "error"; message: string };

const MAX_INPUT_CHARS = 4000;

export function TestDriveSection({
  agent,
  onUnauthorized,
  onNavigateApprovals,
}: TestDriveSectionProps) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  const canSubmit =
    state.kind !== "running" &&
    input.trim().length > 0 &&
    input.length <= MAX_INPUT_CHARS;

  const submit = async () => {
    setState({ kind: "running" });
    const { status, data } = await api<RunResponse | { error: string }>(
      "POST",
      `/admin/api/jacarenda/agents/${agent.id}/runs`,
      { input: input.trim() },
    );
    if (status === 401) {
      onUnauthorized();
      return;
    }
    if ((status !== 200 && status !== 202) || !data || "error" in data) {
      const msg =
        data && "error" in data ? data.error : `Run failed (HTTP ${status}).`;
      setState({ kind: "error", message: msg });
      return;
    }
    if (data.kind === "needs_approval") {
      setState({
        kind: "awaiting_approval",
        run: data.run,
        approvalId: data.approvalId ?? "",
        question: data.question ?? "",
      });
      return;
    }
    setState({
      kind: "result",
      response: data.response ?? "",
      run: data.run,
    });
  };

  const reset = () => {
    setState({ kind: "idle" });
    setInput("");
  };

  return (
    <section className="p-8 rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
          <Play className="w-5 h-5 text-white" />
        </div>
        <h2 className="text-xl font-semibold text-black tracking-tight">
          Test drive
        </h2>
      </div>

      <p className="text-sm text-gray-600 leading-relaxed mb-5">
        Sandbox the agent with any prompt. In draft or ask mode, any action that
        would change the outside world (write to Fibery, post to Slack) pauses
        for your approval. In autopilot, it runs.
      </p>

      <Label
        htmlFor="testdrive-input"
        className="text-sm font-medium text-gray-700 mb-2 block"
      >
        What should it do?
      </Label>
      <Textarea
        id="testdrive-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={state.kind === "running"}
        placeholder="e.g. Draft this week's social posts about the SCOPE Masterclass"
        className="min-h-[120px]"
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-500">
          {input.length}/{MAX_INPUT_CHARS} characters
        </p>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button
          className="bg-black hover:bg-gray-800 text-white h-11 px-5"
          onClick={submit}
          disabled={!canSubmit}
        >
          {state.kind === "running" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Running…</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>Run test drive</span>
            </>
          )}
        </Button>
        {(state.kind === "result" ||
          state.kind === "error" ||
          state.kind === "awaiting_approval") && (
          <Button
            variant="outline"
            className="h-11 px-5 border-gray-300 text-black hover:bg-gray-50"
            onClick={reset}
          >
            Start over
          </Button>
        )}
      </div>

      {state.kind === "awaiting_approval" && (
        <div className="mt-6 p-6 rounded-2xl border border-gray-200 bg-gray-50">
          <div className="flex items-start gap-3 mb-3">
            <Clock className="w-5 h-5 text-black mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-1">
                Awaiting approval
              </p>
              <p className="text-gray-900 font-medium">{state.question}</p>
              <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                The agent paused because this action needs a human sign-off.
                Decide in the Approvals queue — approving resumes the run from
                exactly where it stopped.
              </p>
            </div>
          </div>
          {onNavigateApprovals && (
            <Button
              className="bg-black hover:bg-gray-800 text-white h-10 px-4 mt-1"
              onClick={onNavigateApprovals}
            >
              Go to Approvals
            </Button>
          )}
        </div>
      )}

      {state.kind === "error" && (
        <div className="mt-6 p-5 rounded-xl border border-gray-200 bg-gray-50">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-2">
            Error
          </p>
          <p className="text-sm text-gray-900 leading-relaxed">
            {state.message}
          </p>
        </div>
      )}

      {state.kind === "result" && (
        <div className="mt-6 p-6 rounded-2xl border border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-gray-500">
              Draft output
            </p>
            <p className="text-xs text-gray-500">
              ~{(state.run.totalCostCents / 100).toFixed(3)} € · run{" "}
              <span className="font-mono">{state.run.id.slice(0, 8)}</span>
            </p>
          </div>
          <pre className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap font-inter">
            {state.response}
          </pre>
        </div>
      )}
    </section>
  );
}
