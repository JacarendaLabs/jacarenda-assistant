import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface LoginResponse {
  success?: boolean;
  retryAfterSeconds?: number;
}

interface Props {
  password: string;
  rememberMe: boolean;
  onBack: () => void;
  onAuthenticated: () => void;
}

export function TotpStep({
  password,
  rememberMe,
  onBack,
  onAuthenticated,
}: Props) {
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { status, data } = await api<LoginResponse>(
      "POST",
      "/admin/api/login",
      { password, totp: totp.trim(), rememberMe },
    );
    setSubmitting(false);

    if (status === 429) {
      setError(
        `Too many attempts. Try again in ${data?.retryAfterSeconds ?? "a few"}s.`,
      );
      return;
    }
    if (status !== 200) {
      setError("Invalid code.");
      return;
    }
    onAuthenticated();
  };

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="font-inter text-3xl font-semibold text-black tracking-tight">
        Two-factor code.
      </h1>
      <p className="text-gray-600 text-sm leading-relaxed mt-2">
        Open your authenticator app and enter the 6-digit code.
      </p>

      <label
        htmlFor="login-totp"
        className="block mt-7 mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500"
      >
        Verification code
      </label>
      <Input
        id="login-totp"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoFocus
        autoComplete="one-time-code"
        value={totp}
        onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
        className="h-14 text-center text-2xl font-mono tracking-[0.5em]"
      />

      <div className="flex items-center justify-between mt-7">
        <Button
          type="button"
          variant="ghost"
          className="text-gray-500 hover:text-black hover:bg-gray-50 h-9 px-2"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          type="submit"
          disabled={submitting || totp.length !== 6}
          className="h-12 px-6 bg-black hover:bg-gray-800 text-white"
        >
          {submitting ? "Verifying…" : "Sign in"}
          {!submitting && <ArrowRight className="w-4 h-4" />}
        </Button>
      </div>

      {error && (
        <p className="text-red-500 text-sm mt-4 animate-fade-in">{error}</p>
      )}
    </form>
  );
}
