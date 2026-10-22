"use client";

import { useEffect, useState } from "react";
import { useBitchat } from "@/lib/bitchat/store";
import { peerColor } from "@/lib/bitchat/colors";
import { EMPTY_PEERS, type ChannelMeta } from "@/lib/bitchat/types";
import { Globe, Hash, Radio, X } from "lucide-react";

function ChannelRow({
  meta,
  unread,
  active,
  onClick,
  onLeave,
}: {
  meta: ChannelMeta;
  unread: number;
  active: boolean;
  onClick: () => void;
  onLeave?: () => void;
}) {
  const icon =
    meta.kind === "mesh" ? (
      <Radio className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
    ) : meta.kind === "global" ? (
      <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
    ) : meta.kind === "geo" ? (
      <Hash className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
    ) : null;

  return (
    <div
      className={`group flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-[7px] text-[13px] transition-all duration-150 ${
        active
          ? "bg-emerald-500/[0.12] text-emerald-300 ring-1 ring-inset ring-emerald-400/25"
          : "text-white/65 hover:bg-white/[0.05] hover:text-white/90"
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <span className={active ? "text-emerald-400" : "text-white/30"}>{icon}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{meta.label}</span>
      {unread > 0 && (
        <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 py-px text-[9px] font-bold text-[#080808]">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
      {onLeave && (
        <button
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/30 transition-colors duration-150 hover:bg-white/10 hover:text-red-300 group-hover:flex"
          onClick={(e) => {
            e.stopPropagation();
            onLeave();
          }}
          aria-label={`leave ${meta.label}`}
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
      {children}
    </div>
  );
}

function SidebarContent() {
  const channels = useBitchat((s) => s.channels);
  const activeChannel = useBitchat((s) => s.activeChannel);
  const unread = useBitchat((s) => s.unread);
  const peers = useBitchat((s) => s.peers[s.activeChannel] ?? EMPTY_PEERS);
  const geoChannels = useBitchat((s) => s.geoChannels);
  const setActive = useBitchat((s) => s.setActive);
  const joinChannel = useBitchat((s) => s.joinChannel);
  const leaveChannel = useBitchat((s) => s.leaveChannel);
  const [joinInput, setJoinInput] = useState("");

  const main = channels.filter((c) => c.kind === "mesh" || c.kind === "global");
  const dms = channels.filter((c) => c.kind === "dm" || c.kind === "group");
  const joinedGeo = channels.filter((c) => c.kind === "geo");

  const discovered = geoChannels.filter(
    (g) => !joinedGeo.some((c) => c.id === `geo:${g.geohash}`)
  );

  const submitJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const target = joinInput.trim().toLowerCase().replace(/^#/, "");
    if (!target) return;
    joinChannel(target === "global" ? "global" : `geo:${target}`);
    setJoinInput("");
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden text-white">
      <div className="aether-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        <SectionLabel>channels</SectionLabel>
        <div className="space-y-0.5 px-1.5">
          {main.map((c) => (
            <ChannelRow
              key={c.id}
              meta={c}
              unread={unread[c.id] ?? 0}
              active={c.id === activeChannel}
              onClick={() => setActive(c.id)}
            />
          ))}
          {!channels.some((c) => c.id === "global") && (
            <ChannelRow
              meta={{ id: "global", kind: "global", label: "#global", readOnly: true }}
              unread={0}
              active={false}
              onClick={() => joinChannel("global")}
            />
          )}
        </div>

        {(dms.length > 0 || joinedGeo.length > 0) && (
          <>
            <SectionLabel>open</SectionLabel>
            <div className="space-y-0.5 px-1.5">
              {joinedGeo.map((c) => (
                <ChannelRow
                  key={c.id}
                  meta={c}
                  unread={unread[c.id] ?? 0}
                  active={c.id === activeChannel}
                  onClick={() => setActive(c.id)}
                  onLeave={() => leaveChannel(c.id)}
                />
              ))}
              {dms.map((c) => (
                <ChannelRow
                  key={c.id}
                  meta={c}
                  unread={unread[c.id] ?? 0}
                  active={c.id === activeChannel}
                  onClick={() => setActive(c.id)}
                  onLeave={() => leaveChannel(c.id)}
                />
              ))}
            </div>
          </>
        )}

        <SectionLabel>geo · live nostr</SectionLabel>
        {discovered.length === 0 && (
          <div className="px-3 py-1 text-[10px] text-white/35">listening…</div>
        )}
        <div className="space-y-0.5 px-1.5">
          {discovered.map((g) => (
            <div
              key={g.geohash}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-[7px] text-[12px] text-white/50 transition-all duration-150 hover:bg-white/[0.05] hover:text-white/90"
              onClick={() => joinChannel(`geo:${g.geohash}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && joinChannel(`geo:${g.geohash}`)}
              title={`join #${g.geohash}${g.label ? ` (${g.label})` : ""} — live location channel`}
            >
              <Hash className="h-3.5 w-3.5 shrink-0 text-white/30" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {g.geohash}
                {g.label ? <span className="text-white/30"> · {g.label}</span> : null}
              </span>
              {g.count > 0 && (
                <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-px text-[9px] font-medium text-white/45">
                  {g.count}h
                </span>
              )}
            </div>
          ))}
        </div>

        <SectionLabel>
          peers ·{" "}
          {activeChannel === "mesh"
            ? "#mesh"
            : activeChannel.startsWith("geo:")
              ? activeChannel
              : "chat"}
        </SectionLabel>
        {peers.length === 0 && (
          <div className="px-3 py-1 text-[10px] text-white/35">no one in range</div>
        )}
        <ul className="mb-3 space-y-px px-1.5">
          {peers.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg px-2 py-[3px] text-[11.5px]"
              title={`${p.nickname} · ${p.origin}${p.hops ? ` · ${p.hops} hop${p.hops > 1 ? "s" : ""}` : ""}`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: peerColor(p.nickname),
                  boxShadow: `0 0 6px ${peerColor(p.nickname)}`,
                }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate" style={{ color: peerColor(p.nickname) }}>
                {p.nickname}
              </span>
              <span className="shrink-0 text-[9px] text-white/40">
                {p.origin === "mesh"
                  ? `${p.hops ?? 1}h`
                  : p.origin === "nostr"
                    ? "◆"
                    : "web"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <form
        onSubmit={submitJoin}
        className="shrink-0 border-t border-white/[0.08] p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 transition-all duration-150 focus-within:border-emerald-400/50 focus-within:ring-2 focus-within:ring-emerald-400/10">
          <Hash className="h-3.5 w-3.5 shrink-0 text-white/30" strokeWidth={1.75} />
          <input
            value={joinInput}
            onChange={(e) =>
              setJoinInput(e.target.value.replace(/[^0-9a-zA-Z]/g, "").slice(0, 9))
            }
            placeholder="join geohash (dr5rs)"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/25"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </form>
    </div>
  );
}

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setMobileOpen((v) => !v);
    window.addEventListener("bitchat:toggle-sidebar", handler);
    return () => window.removeEventListener("bitchat:toggle-sidebar", handler);
  }, []);

  return (
    <>
      {/* desktop */}
      <nav
        className="hidden w-60 shrink-0 border-r border-white/[0.08] bg-black/20 md:block"
        aria-label="channels"
      >
        <SidebarContent />
      </nav>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <nav className="aether-in absolute left-0 top-0 flex h-full w-72 flex-col border-r border-white/10 bg-[#0b0b0b]/95 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.9)] backdrop-blur-xl">
            <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-4">
              <span className="text-[13px] font-semibold tracking-tight text-white">
                bitchat
                <span className="blink ml-0.5 align-[0.05em] text-emerald-400">▌</span>
              </span>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
                onClick={() => setMobileOpen(false)}
                aria-label="close channel list"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SidebarContent />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
