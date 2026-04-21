import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";

interface FormRowProps {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  type?: string;
}

/**
 * Two-column labelled input (label left, input + hint right).
 * Collapses to a single column on < md.
 */
export function FormRow({
  label,
  id,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
}: FormRowProps) {
  return (
    <div className="grid md:grid-cols-[180px_1fr] gap-3 md:gap-6 md:items-start pt-5 border-t border-gray-100 first:pt-0 first:border-t-0">
      <label htmlFor={id} className="text-sm font-medium text-black md:pt-3">
        {label}
      </label>
      <div className="space-y-2">
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="h-11 font-mono text-[13px]"
        />
        {hint && (
          <p className="text-[13px] text-gray-600 leading-relaxed">{hint}</p>
        )}
      </div>
    </div>
  );
}
