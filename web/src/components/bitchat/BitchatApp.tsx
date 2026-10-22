"use client";

import { useEffect } from "react";
import { useBitchat } from "@/lib/bitchat/store";
import NicknameGate from "./NicknameGate";
import AetherCanvas from "./AetherCanvas";
import HeaderBar from "./HeaderBar";
import Sidebar from "./Sidebar";
import MessageList from "./MessageList";
import Composer from "./Composer";

export default function BitchatApp() {
  const phase = useBitchat((s) => s.phase);
  const connected = useBitchat((s) => s.connected);
  const connect = useBitchat((s) => s.connect);
  const savedNickname = useBitchat((s) => s.savedNickname);

  useEffect(() => {
    const saved = savedNickname();
    if (saved) connect(saved);
  }, [connect, savedNickname]);

  if (phase === "gate") return <NicknameGate />;

  return (
    <div className="relative h-dvh overflow-hidden bg-[#080808] font-sans text-white">
      <AetherCanvas />
      {/* ambient emerald aura above the dot field */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(58% 46% at 50% 0%, rgba(16,185,129,0.07), transparent 70%)",
        }}
      />

      <div className="aether-page relative z-10 flex h-full flex-col">
        {/* the app as one bounded glass slab in a gradient border shell */}
        <div className="aether-shell flex min-h-0 flex-1">
          <div className="aether-surface flex min-h-0 flex-1 flex-col overflow-hidden">
            <HeaderBar />

            {!connected && phase === "ready" && (
              <div className="flex items-center gap-2 border-b border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-[11px] text-white/55">
                <span
                  className="aether-pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400"
                  aria-hidden="true"
                />
                connection lost — reconnecting to the mesh…
              </div>
            )}

            <div className="flex min-h-0 flex-1">
              <Sidebar />
              <main className="flex min-w-0 flex-1 flex-col">
                <MessageList />
                <Composer />
              </main>
            </div>

            <footer className="mt-auto flex h-8 shrink-0 items-center justify-between gap-3 border-t border-white/[0.08] bg-black/30 px-4 text-[10px] text-white/35">
              <span className="truncate">
                bitchat web · fork: 0xumaki/bitchat · nostr kind-20000 ephemeral ·
                16-bit pow
              </span>
              <span className="hidden shrink-0 sm:inline">
                no accounts · no phone numbers · no servers · triple-tap logo to
                wipe
              </span>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
