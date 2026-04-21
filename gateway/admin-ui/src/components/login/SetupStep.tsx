import { useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SetupPayload } from "./LoginView";

interface Props {
  payload: SetupPayload;
  rememberMe: boolean;
  onAuthenticated: () => void;
}

export function SetupStep({ payload, rememberMe, onAuthenticated }: Props) {
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(payload.secretBase32);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard access can be blocked; user can select manually */
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { status } = await api("POST", "/admin/api/login/confirm-totp", {
      setupToken: payload.setupToken,
      totp: totp.trim(),
      rememberMe,
    });
    setSubmitting(false);
    if (status !== 200) {
      setError("Invalid code. Try the current one shown in your app.");
      return;
    }
    onAuthenticated();
  };

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="font-inter text-3xl font-semibold text-black tracking-tight">
        Set up 2FA.
      </h1>
      <p className="text-gray-600 text-sm leading-relaxed mt-2">
        One-time setup. Scan the QR with any authenticator app (1Password,
        Authy, Google Authenticator, Bitwarden).
      </p>

      <div className="mt-6 p-6 rounded-xl bg-gray-50 border border-gray-100">
        <div className="flex justify-center">
          <div
            className="bg-white border border-gray-100 rounded-lg p-3 [&_svg]:h-[168px] [&_svg]:w-[168px]"
            dangerouslySetInnerHTML={{ __html: payload.qrSvg }}
          />
        </div>

        <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">
          Can't scan? Enter this secret manually
        </p>
        <div className="mt-2 flex items-center gap-2 bg-white border border-gray-200 rounded-md p-3">
          <span className="flex-1 min-w-0 font-mono text-[12.5px] tracking-[0.08em] break-all text-black select-all">
            {payload.secretBase32}
          </span>
          <button
            type="button"
            onClick={copySecret}
            aria-label="Copy secret"
            className="flex-shrink-0 p-1.5 rounded-md text-gray-400 hover:text-black hover:bg-gray-50 transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-600" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      <label
        htmlFor="setup-totp"
        className="block mt-6 mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500"
      >
        Verification code
      </label>
      <Input
        id="setup-totp"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoFocus
        autoComplete="one-time-code"
        value={totp}
        onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
        className={cn(
          "h-14 text-center text-2xl font-mono tracking-[0.5em]",
          error && "border-red-500 animate-shake",
        )}
      />

      <Button
        type="submit"
        disabled={submitting || totp.length !== 6}
        className="h-12 px-6 mt-6 bg-black hover:bg-gray-800 text-white"
      >
        {submitting ? "Confirming…" : "Confirm and sign in"}
        {!submitting && <ArrowRight className="w-4 h-4" />}
      </Button>

      {error && (
        <p className="text-red-500 text-sm mt-4 animate-fade-in">{error}</p>
      )}
    </form>
  );
}
