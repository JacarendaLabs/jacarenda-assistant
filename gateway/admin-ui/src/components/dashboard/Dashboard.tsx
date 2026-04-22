import { TopBar } from "@/components/layout/TopBar";
import { ChannelsSection } from "@/components/dashboard/ChannelsSection";
import { useStageAnimations } from "@/hooks/useStageAnimations";

interface DashboardProps {
  onSignOut: () => void;
  onUnauthorized: () => void;
  onNavigateAgents: () => void;
}

export function Dashboard({
  onSignOut,
  onUnauthorized,
  onNavigateAgents,
}: DashboardProps) {
  useStageAnimations();

  return (
    <div className="min-h-screen bg-white">
      <TopBar
        onSignOut={onSignOut}
        activeTab="channels"
        onNavigateChannels={() => {
          /* no-op — already here */
        }}
        onNavigateAgents={onNavigateAgents}
      />

      <main>
        {/* Hero — sized for admin, not marketing (mid-scale, not landing) */}
        <section className="pt-32 pb-10 bg-white">
          <div className="container mx-auto px-6 max-w-5xl">
            <div className="inline-flex items-center gap-2 bg-black/5 border border-gray-200 rounded-full px-3 py-1.5 mb-6 animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-black" />
              <span className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-black">
                Channels
              </span>
            </div>
            <h1 className="font-inter text-4xl md:text-5xl font-bold text-black tracking-tight leading-[1.05]">
              Connect messaging.
            </h1>
            <p className="text-lg md:text-xl text-gray-600 mt-4 max-w-2xl leading-relaxed">
              Slack, Telegram, and WhatsApp. Credentials stay encrypted on-disk
              and never leave this machine.
            </p>
          </div>
        </section>

        <section id="channels" className="pb-24 pt-2 bg-white">
          <div className="container mx-auto px-6 max-w-5xl">
            <ChannelsSection onUnauthorized={onUnauthorized} />
          </div>
        </section>
      </main>
    </div>
  );
}
