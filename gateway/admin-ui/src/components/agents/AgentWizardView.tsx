import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Loader2,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Agent } from "@/components/agents/types";
import { VOICE_STYLES, type VoiceStyle } from "@/components/agents/voiceStyles";

/* ------------------------------------------------------------------ types */

interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultPersonality: string;
  defaultRules: string;
  defaultTools: string[];
  defaultTrustMode: "draft" | "ask" | "autopilot";
  defaultTriggerConfig: Record<string, unknown>;
  defaultSpendCapCents: number;
}

interface ToolSpec {
  id: string;
  label: string;
  description: string;
  plainEnglish: string;
  category: "data" | "messaging" | "llm" | "automation";
  riskTier: 1 | 2 | 3;
}

interface AgentWizardViewProps {
  onSignOut: () => void;
  onUnauthorized: () => void;
  onCancel: () => void;
  onCreated: (agent: Agent) => void;
  onNavigateChannels: () => void;
}

type TrustMode = "draft" | "ask" | "autopilot";

interface Draft {
  templateId: string | null;
  name: string;
  personality: string;
  rules: string;
  toolAllowlist: string[];
  trustMode: TrustMode;
}

const STEP_LABELS = [
  "Pick a template",
  "Name it",
  "Personality",
  "Rules",
  "What it can do",
  "Trust level",
  "Review",
] as const;

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/* ------------------------------------------------------------- component */

export function AgentWizardView({
  onSignOut,
  onUnauthorized,
  onCancel,
  onCreated,
  onNavigateChannels,
}: AgentWizardViewProps) {
  const [templates, setTemplates] = useState<AgentTemplate[] | null>(null);
  const [tools, setTools] = useState<ToolSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Draft>({
    templateId: null,
    name: "",
    personality: "",
    rules: "",
    toolAllowlist: [],
    trustMode: "draft",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load templates + tools
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [t, k] = await Promise.all([
        api<{ templates: AgentTemplate[] }>(
          "GET",
          "/admin/api/jacarenda/templates",
        ),
        api<{ tools: ToolSpec[] }>("GET", "/admin/api/jacarenda/tools"),
      ]);
      if (cancelled) return;
      if (t.status === 401 || k.status === 401) {
        onUnauthorized();
        return;
      }
      if (t.status !== 200 || k.status !== 200) {
        setLoadError("Couldn't load templates. Try refreshing.");
        return;
      }
      setTemplates(t.data?.templates ?? []);
      setTools(k.data?.tools ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  const selectedTemplate = useMemo(
    () => templates?.find((t) => t.id === draft.templateId) ?? null,
    [templates, draft.templateId],
  );

  // When a template is picked, pre-fill from its defaults
  const pickTemplate = (templateId: string) => {
    const tpl = templates?.find((t) => t.id === templateId);
    if (!tpl) return;
    setDraft({
      templateId: tpl.id,
      name: tpl.name,
      personality: tpl.defaultPersonality,
      rules: tpl.defaultRules,
      toolAllowlist: [...tpl.defaultTools],
      trustMode: tpl.defaultTrustMode,
    });
  };

  const toggleTool = (id: string) => {
    setDraft((d) => ({
      ...d,
      toolAllowlist: d.toolAllowlist.includes(id)
        ? d.toolAllowlist.filter((x) => x !== id)
        : [...d.toolAllowlist, id],
    }));
  };

  const canContinue = ((): boolean => {
    switch (step) {
      case 0:
        return Boolean(draft.templateId);
      case 1:
        return draft.name.trim().length > 0;
      case 2:
        return draft.personality.trim().length > 0;
      case 3:
        return true; // Rules can be empty; template fills it, user can erase
      case 4:
        return true; // Any tool combo is valid, incl. zero
      case 5:
        return true;
      case 6:
        return !submitting;
      default:
        return false;
    }
  })();

  const goNext = async () => {
    if (step < 6) {
      setStep(((step as number) + 1) as Step);
      return;
    }
    // Submit
    if (!selectedTemplate) return;
    setSubmitError(null);
    setSubmitting(true);
    const { status, data } = await api<{ agent: Agent }>(
      "POST",
      "/admin/api/jacarenda/agents",
      {
        templateId: selectedTemplate.id,
        name: draft.name.trim(),
        personality: draft.personality.trim(),
        rules: draft.rules,
        toolAllowlist: draft.toolAllowlist,
        trustMode: draft.trustMode,
        status: "paused",
      },
    );
    setSubmitting(false);
    if (status === 401) {
      onUnauthorized();
      return;
    }
    if (status !== 201 || !data?.agent) {
      setSubmitError(`Couldn't save (HTTP ${status}). Try again.`);
      return;
    }
    onCreated(data.agent);
  };

  const goBack = () => {
    if (step === 0) {
      onCancel();
      return;
    }
    setStep(((step as number) - 1) as Step);
  };

  return (
    <div className="min-h-screen bg-white">
      <TopBar
        onSignOut={onSignOut}
        activeTab="agents"
        onNavigateChannels={onNavigateChannels}
        onNavigateAgents={onCancel}
      />

      <main>
        <section className="pt-28 pb-24 bg-white">
          <div className="container mx-auto px-6 max-w-2xl">
            <StepIndicator step={step} />

            {loadError && (
              <div className="py-16 text-center">
                <p className="text-gray-900 font-medium">{loadError}</p>
              </div>
            )}

            {!loadError && (!templates || !tools) && (
              <div className="py-16 text-center text-gray-500 text-sm">
                Loading templates…
              </div>
            )}

            {!loadError && templates && tools && (
              <div className="mt-10">
                {step === 0 && (
                  <Step0Template
                    templates={templates}
                    selectedId={draft.templateId}
                    onPick={pickTemplate}
                  />
                )}
                {step === 1 && selectedTemplate && (
                  <Step1Name
                    template={selectedTemplate}
                    value={draft.name}
                    onChange={(name) => setDraft((d) => ({ ...d, name }))}
                  />
                )}
                {step === 2 && (
                  <Step2Personality
                    value={draft.personality}
                    onChange={(personality) =>
                      setDraft((d) => ({ ...d, personality }))
                    }
                  />
                )}
                {step === 3 && (
                  <Step3Rules
                    value={draft.rules}
                    onChange={(rules) => setDraft((d) => ({ ...d, rules }))}
                  />
                )}
                {step === 4 && (
                  <Step4Tools
                    tools={tools}
                    selected={draft.toolAllowlist}
                    onToggle={toggleTool}
                  />
                )}
                {step === 5 && (
                  <Step5Trust
                    value={draft.trustMode}
                    onChange={(trustMode) =>
                      setDraft((d) => ({ ...d, trustMode }))
                    }
                  />
                )}
                {step === 6 && selectedTemplate && (
                  <Step6Review
                    draft={draft}
                    tools={tools}
                    submitError={submitError}
                  />
                )}

                <div className="mt-10 flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    className="h-12 px-6 border-gray-300 text-black hover:bg-black hover:text-white hover:border-black"
                    onClick={goBack}
                    disabled={submitting}
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>{step === 0 ? "Cancel" : "Back"}</span>
                  </Button>
                  <Button
                    className="bg-black hover:bg-gray-800 text-white h-12 px-6"
                    onClick={goNext}
                    disabled={!canContinue}
                  >
                    {step === 6 ? (
                      submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Saving…</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Create agent</span>
                        </>
                      )
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

/* ----------------------------------------------------------------- steps */

function StepIndicator({ step }: { step: Step }) {
  const total = STEP_LABELS.length;
  const pct = ((step + 1) / total) * 100;
  return (
    <div className="mt-24">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-gray-500">
          Step {step + 1} of {total}
        </span>
        <span className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-black">
          {STEP_LABELS[step]}
        </span>
      </div>
      <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-black transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StepHeader({ title, subcopy }: { title: string; subcopy: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-inter text-3xl md:text-4xl font-bold text-black tracking-tight leading-[1.1]">
        {title}
      </h1>
      <p className="text-gray-600 mt-3 leading-relaxed">{subcopy}</p>
    </div>
  );
}

function Step0Template({
  templates,
  selectedId,
  onPick,
}: {
  templates: AgentTemplate[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Pick a template."
        subcopy="Every agent starts from a template. You can tune everything in the next few steps — this just gives you a sensible starting point."
      />
      <div className="space-y-3">
        {templates.map((t) => {
          const active = selectedId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t.id)}
              className={cn(
                "group w-full text-left p-6 rounded-2xl border bg-white shadow-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
                active
                  ? "border-black"
                  : "border-gray-100 hover:border-gray-300 hover-lift",
              )}
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-black">{t.name}</p>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] bg-gray-100 text-gray-700 border border-gray-200">
                      {t.category}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {t.description}
                  </p>
                </div>
                {active && (
                  <CircleCheck className="w-5 h-5 text-black flex-shrink-0 mt-1" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Step1Name({
  template,
  value,
  onChange,
}: {
  template: AgentTemplate;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <StepHeader
        title="What will you call it?"
        subcopy={`Give your ${template.name.toLowerCase()} a name. You can change it later — something short and memorable works best.`}
      />
      <Label
        htmlFor="agent-name"
        className="text-sm font-medium text-gray-700 mb-2 block"
      >
        Agent name
      </Label>
      <Input
        id="agent-name"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={template.name}
        className="h-12 text-base"
      />
    </div>
  );
}

type VoiceMode = "pick" | "paste" | "tweak";

function Step2Personality({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [mode, setMode] = useState<VoiceMode>("pick");
  const [pickedStyleId, setPickedStyleId] = useState<string | null>(null);
  const [samples, setSamples] = useState("");

  const pickStyle = (style: VoiceStyle) => {
    setPickedStyleId(style.id);
    onChange(style.brief);
  };

  // When user edits the freeform textarea in "tweak" mode, we stop
  // tracking a specific style — whatever they've written stands on its own.
  const handleFreeformChange = (v: string) => {
    onChange(v);
  };

  const handleSamplesChange = (v: string) => {
    setSamples(v);
    const trimmed = v.trim();
    if (trimmed.length === 0) {
      onChange("");
      return;
    }
    onChange(
      `You write in the style of the samples below. Match their rhythm, vocabulary, and level of formality. Never invent clients, numbers, or claims the samples don't support.\n\n--- SAMPLES ---\n${trimmed}`,
    );
  };

  return (
    <div>
      <StepHeader
        title="How should it sound?"
        subcopy="Pick a style, or paste a few of your own messages so the agent matches your voice."
      />

      <ModeSwitch
        mode={mode}
        onChange={(m) => {
          setMode(m);
          if (m === "pick") {
            // Reset to last-picked style or clear
            const current = VOICE_STYLES.find((s) => s.brief === value);
            setPickedStyleId(current?.id ?? null);
            if (!current && pickedStyleId) {
              const last = VOICE_STYLES.find((s) => s.id === pickedStyleId);
              if (last) onChange(last.brief);
            }
          } else if (m === "paste") {
            // If we don't have any sample-flavoured text yet, clear personality
            if (!value.startsWith("You write in the style of the samples")) {
              setSamples("");
              onChange("");
            }
          }
        }}
      />

      {mode === "pick" && (
        <div className="mt-8 space-y-3">
          {VOICE_STYLES.map((style) => {
            const active = pickedStyleId === style.id;
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => pickStyle(style)}
                className={cn(
                  "w-full text-left p-6 rounded-2xl border bg-white shadow-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
                  active
                    ? "border-black"
                    : "border-gray-100 hover:border-gray-300 hover-lift",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-black">{style.label}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {style.oneLine}
                    </p>
                  </div>
                  {active && (
                    <CircleCheck className="w-5 h-5 text-black flex-shrink-0 mt-1" />
                  )}
                </div>
                <div className="mt-4 p-4 rounded-xl bg-gray-50 border border-gray-100">
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-2">
                    Sample
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed italic">
                    &ldquo;{style.sample}&rdquo;
                  </p>
                </div>
              </button>
            );
          })}

          {pickedStyleId && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setMode("tweak")}
                className="text-sm text-gray-600 hover:text-black underline underline-offset-4"
              >
                Tweak this voice in your own words →
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "paste" && (
        <div className="mt-8">
          <Label
            htmlFor="agent-samples"
            className="text-sm font-medium text-gray-700 mb-2 block"
          >
            Paste 3–5 things you've written
          </Label>
          <Textarea
            id="agent-samples"
            value={samples}
            onChange={(e) => handleSamplesChange(e.target.value)}
            placeholder={`Paste a LinkedIn post, an email you sent, a message to a client — anything you've written that sounds like you.\n\nSeparate each sample with a blank line.`}
            className="min-h-[260px]"
          />
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            We store these as your voice reference. The agent will match the
            rhythm, vocabulary, and formality without copying phrases.
          </p>
        </div>
      )}

      {mode === "tweak" && (
        <div className="mt-8">
          <Label
            htmlFor="agent-personality"
            className="text-sm font-medium text-gray-700 mb-2 block"
          >
            Voice brief
          </Label>
          <Textarea
            id="agent-personality"
            value={value}
            onChange={(e) => handleFreeformChange(e.target.value)}
            className="min-h-[240px]"
          />
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            Writing in the second person works best (&ldquo;You write
            like…&rdquo;). Name what to avoid as well as what to embrace.
          </p>
          <div className="pt-4">
            <button
              type="button"
              onClick={() => setMode("pick")}
              className="text-sm text-gray-600 hover:text-black underline underline-offset-4"
            >
              ← Back to style picker
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: VoiceMode;
  onChange: (m: VoiceMode) => void;
}) {
  const visibleModes: { id: VoiceMode; label: string }[] = [
    { id: "pick", label: "Pick a style" },
    { id: "paste", label: "Paste my writing" },
  ];
  // The "tweak" mode is reached via the inline link from "pick" — we
  // don't surface it as a top-level tab because most users won't need it.
  return (
    <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-1">
      {visibleModes.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={cn(
            "px-4 h-9 rounded-md text-sm font-medium transition-colors",
            mode === m.id || (mode === "tweak" && m.id === "pick")
              ? "bg-black text-white"
              : "text-gray-700 hover:text-black",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function Step3Rules({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <StepHeader
        title="What are the ground rules?"
        subcopy="Hard lines the agent will never cross. One rule per line. Keep them specific — vague rules don't work."
      />
      <Label
        htmlFor="agent-rules"
        className="text-sm font-medium text-gray-700 mb-2 block"
      >
        Rules
      </Label>
      <Textarea
        id="agent-rules"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[220px] font-mono text-sm"
        placeholder="One rule per line. E.g. Never publish without human approval."
      />
    </div>
  );
}

function Step4Tools({
  tools,
  selected,
  onToggle,
}: {
  tools: ToolSpec[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <StepHeader
        title="What can it do?"
        subcopy="These are the actions you're granting. Tick only what this agent needs — you can add more later."
      />
      <div className="space-y-3">
        {tools.map((tool) => {
          const checked = selected.includes(tool.id);
          const trust =
            tool.riskTier === 3
              ? "High trust"
              : tool.riskTier === 2
                ? "Medium trust"
                : "Low trust";
          return (
            <label
              key={tool.id}
              className={cn(
                "flex items-start gap-4 p-5 rounded-2xl border bg-white shadow-sm cursor-pointer transition-colors",
                checked
                  ? "border-black"
                  : "border-gray-100 hover:border-gray-300",
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggle(tool.id)}
                className="mt-1 flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="font-medium text-black">{tool.label}</p>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] bg-gray-100 text-gray-700 border border-gray-200">
                    {trust}
                  </span>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {tool.plainEnglish}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Step5Trust({
  value,
  onChange,
}: {
  value: TrustMode;
  onChange: (v: TrustMode) => void;
}) {
  const options: {
    id: TrustMode;
    title: string;
    sub: string;
    icon: typeof CircleDashed;
  }[] = [
    {
      id: "draft",
      title: "Draft only",
      sub: "Safest. Writes drafts and puts them in an approval queue. Nothing ever goes out without you clicking approve.",
      icon: CircleDashed,
    },
    {
      id: "ask",
      title: "Ask first",
      sub: "Messages you on Slack or WhatsApp before taking action. You confirm once, it proceeds.",
      icon: CircleDot,
    },
    {
      id: "autopilot",
      title: "Autopilot",
      sub: "Fastest. Runs independently, reports what it did. Only turn this on once you trust the output.",
      icon: CircleCheck,
    },
  ];
  return (
    <div>
      <StepHeader
        title="How much autonomy?"
        subcopy="Start with Draft — you can always give the agent more rope once you've seen it work."
      />
      <div className="space-y-3">
        {options.map((opt) => {
          const active = value === opt.id;
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={cn(
                "w-full text-left p-6 rounded-2xl border bg-white shadow-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
                active
                  ? "border-black"
                  : "border-gray-100 hover:border-gray-300 hover-lift",
              )}
            >
              <div className="flex items-start gap-4">
                <Icon className="w-5 h-5 text-black mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-black">{opt.title}</p>
                  <p className="text-sm text-gray-600 leading-relaxed mt-1">
                    {opt.sub}
                  </p>
                </div>
                {active && (
                  <CircleCheck className="w-5 h-5 text-black flex-shrink-0 mt-0.5" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Step6Review({
  draft,
  tools,
  submitError,
}: {
  draft: Draft;
  tools: ToolSpec[];
  submitError: string | null;
}) {
  const selectedTools = draft.toolAllowlist
    .map((id) => tools.find((t) => t.id === id))
    .filter((t): t is ToolSpec => Boolean(t));
  const trustLabel =
    draft.trustMode === "draft"
      ? "Draft only"
      : draft.trustMode === "ask"
        ? "Ask first"
        : "Autopilot";
  return (
    <div>
      <StepHeader
        title="Look it over."
        subcopy="We'll save this as Paused — nothing runs until you flip it on from the detail page."
      />

      <div className="space-y-3">
        <ReviewRow label="Name" value={draft.name} />
        <ReviewRow label="Trust level" value={trustLabel} />
        <ReviewRow
          label="Can use"
          value={
            selectedTools.length === 0
              ? "No tools"
              : selectedTools.map((t) => t.label).join(" · ")
          }
        />
      </div>

      {submitError && (
        <p className="text-sm text-red-700 mt-6 leading-relaxed">
          {submitError}
        </p>
      )}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50/50">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-gray-500 w-28 flex-shrink-0 mt-0.5">
        {label}
      </p>
      <p className="text-gray-900 font-medium flex-1 min-w-0">{value}</p>
    </div>
  );
}
