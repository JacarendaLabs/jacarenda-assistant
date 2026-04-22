import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TopBarProps {
  onSignOut: () => void;
  /** Active tab — used to style the nav. Omit to hide nav entirely. */
  activeTab?: "channels" | "agents" | "approvals";
  onNavigateChannels?: () => void;
  onNavigateAgents?: () => void;
  onNavigateApprovals?: () => void;
}

/**
 * Fixed-top bar that mirrors jacarendalabs.com's header behaviour:
 * transparent at the top → frosted white + shadow-sm once scrolled past
 * 50px. Sign-out is a proper outline button with a confirm guard. If
 * nav callbacks are supplied, a slim tab row appears between the brand
 * lockup and the sign-out button.
 */
export function TopBar({
  onSignOut,
  activeTab,
  onNavigateChannels,
  onNavigateAgents,
  onNavigateApprovals,
}: TopBarProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSignOutClick = () => {
    if (!window.confirm("Sign out of Assistant Admin?")) return;
    onSignOut();
  };

  const showNav = Boolean(
    onNavigateChannels || onNavigateAgents || onNavigateApprovals,
  );

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-white/95 backdrop-blur-sm shadow-sm border-b border-gray-100"
          : "bg-white/70 backdrop-blur-sm",
      )}
    >
      <div
        className={cn(
          "container mx-auto px-6 flex items-center justify-between gap-6 transition-all duration-200",
          scrolled ? "py-2" : "py-3",
        )}
      >
        <a
          href="/admin"
          className="flex items-center gap-3 text-black hover:opacity-80 transition-opacity"
        >
          <img
            src="/admin/logo-256.png"
            alt=""
            className="h-7 w-auto block"
            aria-hidden="true"
          />
          <span className="font-inter font-semibold tracking-tight text-[15px]">
            Jacarenda Labs
          </span>
          <span className="h-4 w-px bg-gray-300 mx-1" aria-hidden="true" />
          <span className="text-[13px] text-gray-500">Assistant Admin</span>
        </a>

        {showNav && (
          <nav className="hidden md:flex items-center gap-1">
            {onNavigateChannels && (
              <NavTab
                label="Channels"
                active={activeTab === "channels"}
                onClick={onNavigateChannels}
              />
            )}
            {onNavigateAgents && (
              <NavTab
                label="Agents"
                active={activeTab === "agents"}
                onClick={onNavigateAgents}
              />
            )}
            {onNavigateApprovals && (
              <NavTab
                label="Approvals"
                active={activeTab === "approvals"}
                onClick={onNavigateApprovals}
              />
            )}
          </nav>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-9 px-4 border-gray-300 text-black hover:bg-black hover:text-white hover:border-black"
          onClick={handleSignOutClick}
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </Button>
      </div>
    </header>
  );
}

function NavTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 h-9 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-black text-white"
          : "text-gray-700 hover:text-black hover:bg-gray-100",
      )}
    >
      {label}
    </button>
  );
}
