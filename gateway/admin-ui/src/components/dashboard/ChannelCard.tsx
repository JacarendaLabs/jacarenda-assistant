import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelState } from "./ChannelsSection";

interface ChannelCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  state: ChannelState | null;
  children: ReactNode;
  instructions: ReactNode;
  actions: ReactNode;
  meta?: ReactNode;
}

/**
 * Signature JL card: rounded-2xl, border-gray-100, hover-lift, with the
 * black w-14 h-14 rounded-xl icon tile that scales on group-hover.
 */
export function ChannelCard({
  icon,
  title,
  description,
  state,
  children,
  instructions,
  actions,
  meta,
}: ChannelCardProps) {
  const connected = state?.connected === true;
  return (
    <div className="stage-item group p-8 rounded-2xl border border-gray-100 hover:border-gray-300 hover-lift transition-all duration-300 bg-white">
      <div className="flex items-start gap-5">
        <div className="w-14 h-14 bg-black rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300">
          <span className="text-white [&>svg]:w-6 [&>svg]:h-6">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-inter text-xl font-semibold text-black tracking-tight">
            {title}
          </h3>
          <p className="text-gray-600 text-sm leading-relaxed mt-1">
            {description}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-medium flex-shrink-0",
            connected
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-gray-50 border-gray-200 text-gray-500",
          )}
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              connected ? "bg-green-600" : "bg-gray-400",
            )}
          />
          {connected ? "Active" : "Not connected"}
        </span>
      </div>

      {meta && <div className="mt-7">{meta}</div>}

      <div className="mt-8 space-y-5">{children}</div>

      <details className="group/details mt-7 rounded-lg bg-gray-50 border border-gray-100">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm text-black font-medium flex items-center gap-2.5 [&::-webkit-details-marker]:hidden">
          <ChevronDown className="w-4 h-4 text-gray-500 transition-transform group-open/details:rotate-180" />
          How to get these credentials
        </summary>
        <div className="px-5 pb-5 pl-12 text-sm text-gray-600 leading-relaxed space-y-3 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:bg-white [&_code]:border [&_code]:border-gray-200 [&_code]:rounded [&_code]:text-[12.5px] [&_code]:font-mono [&_code]:text-black [&_strong]:text-black [&_strong]:font-semibold [&_a]:text-black [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-gray-300 hover:[&_a]:decoration-black [&_ol]:list-decimal [&_ol]:pl-5 [&_ol>li]:mb-2">
          {instructions}
        </div>
      </details>

      <div className="mt-7 flex items-center gap-3 flex-wrap">{actions}</div>
    </div>
  );
}

interface MetaInfoProps {
  rows: Array<[string, string]>;
}

export function MetaInfo({ rows }: MetaInfoProps) {
  if (!rows.length) return null;
  return (
    <dl className="border-l-2 border-gray-200 pl-5 grid grid-cols-[180px_1fr] gap-x-6 gap-y-2.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[11px] uppercase tracking-[0.06em] text-gray-500 font-medium pt-px">
            {k}
          </dt>
          <dd className="m-0 font-mono text-[13px] break-all text-black">
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
