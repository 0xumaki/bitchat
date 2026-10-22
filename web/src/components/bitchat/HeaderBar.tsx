"use client";

import { useRef, useState } from "react";
import { useBitchat } from "@/lib/bitchat/store";
import { channelLabel, channelKindOf, EMPTY_PEERS } from "@/lib/bitchat/types";
import { Menu } from "lucide-react";

function TransportBadge({
  label,
  count,
  total,
  ok,
  title,
}: {
  label: string;
  count: number;
  total?: number;
  ok: boolean;
  title: string;
}) {
  return (
    <span
      title={title}
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium sm:inline-flex ${
        ok
          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
          : "border-red-400/20 bg-red-500/10 text-red-300/80"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "aether-pulse-dot bg-emerald-400" : "bg-red-400/70"}`}
        aria-hidden="true"
      />
      {label}
      {total !== undefined ? ` ${count}/${total}` : count > 0 ? ` ${count}` : ""}
    </span>
  );
}

export default function HeaderBar() {
  const activeChannel = useBitchat((s) => s.activeChannel);
  const nickname = useBitchat((s) => s.nickname);
  const relays = useBitchat((s) => s.relays);
  const peers = useBitchat((s) => s.peers[s.activeChannel] ?? EMPTY_PEERS);
  const channels = useBitchat((s) => s.channels);
  const [menuOpen, setMenuOpen] = useState(false);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const relaysUp = relays.filter((r) => r.connected).length;
  const kind = channelKindOf(activeChannel);
  const meta = channels.find((c) => c.id === activeChannel);

  const kindDescription =
    kind === "mesh"
      ? "bluetooth mesh · simulated"
      : kind === "global"
        ? "all geohash traffic · read-only"
        : kind === "geo"
          ? "live nostr · public relays"
          : kind === "group"
            ? "encrypted group · mesh"
            : "private message";

  // triple-tap logo = emergency wipe (like the app's panic wipe)
  const logoTapped = () => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => (tapCount.current = 0), 900);
    if (tapCount.current >= 3) {
      tapCount.current = 0;
      const sure = window.confirm(
        "panic wipe? this clears your local identity and chats."
      );
      if (sure) {
        try {
          window.localStorage.removeItem("bitchat:nickname");
        } catch {}
        window.location.reload();
      }
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-white/[0.02] px-3 sm:px-4">
      <button
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white md:hidden"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("bitchat:toggle-sidebar"));
          setMenuOpen((v) => !v);
        }}
        aria-label="toggle channel list"
      >
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </button>

      <button
        onClick={logoTapped}
        title="bitchat (triple-tap for panic wipe)"
        className="shrink-0 select-none text-[15px] font-semibold tracking-tight text-white"
      >
        bitchat<span className="blink ml-0.5 align-[0.05em] text-emerald-400">▌</span>
      </button>

      <div className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />

      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] font-medium text-white/90">
          {meta?.label ?? channelLabel(activeChannel)}
        </div>
        <div className="truncate text-[10px] text-white/40">{kindDescription}</div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <TransportBadge
          label="BT"
          count={peers.filter((p) => p.origin === "mesh").length}
          ok={peers.some((p) => p.origin === "mesh")}
          title="bluetooth mesh peers in range (simulated)"
        />
        <TransportBadge
          label="NOSTR"
          count={relaysUp}
          total={relays.length || 4}
          ok={relaysUp > 0}
          title={relays
            .map((r) => `${r.url.replace("wss://", "")} ${r.connected ? "✓" : "✗"}`)
            .join("\n")}
        />
        <span className="hidden rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-medium text-white/50 md:inline">
          @{nickname}
        </span>
      </div>
    </header>
  );
}
