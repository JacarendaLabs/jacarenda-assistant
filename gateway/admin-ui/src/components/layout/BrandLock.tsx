import { cn } from "@/lib/utils";

interface BrandLockProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * The Jacarenda Labs brand lock-up: JL emblem + wordmark + optional
 * sub-label. Pure visual — no link behaviour — wrap in an anchor if needed.
 */
export function BrandLock({ size = "md", className }: BrandLockProps) {
  const logoSize = size === "sm" ? "h-8" : size === "lg" ? "h-12" : "h-[38px]";
  const wordmark =
    size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-xl";
  const sub =
    size === "sm" ? "text-[11px]" : size === "lg" ? "text-xs" : "text-[11px]";

  return (
    <div className={cn("flex items-end gap-3", className)}>
      <img
        src="/admin/logo-256.png"
        alt="Jacarenda Labs"
        className={cn(logoSize, "w-auto block")}
      />
      <div className="flex flex-col leading-none">
        <span
          className={cn(
            "font-inter font-semibold text-black tracking-tight",
            wordmark,
          )}
        >
          Jacarenda Labs
        </span>
        <span
          className={cn(
            "text-gray-500 mt-1.5 font-medium uppercase tracking-[0.08em]",
            sub,
          )}
        >
          Assistant Admin
        </span>
      </div>
    </div>
  );
}
