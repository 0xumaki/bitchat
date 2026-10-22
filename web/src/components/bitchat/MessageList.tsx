"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBitchat } from "@/lib/bitchat/store";
import { peerColor } from "@/lib/bitchat/colors";
import { Check, ChevronDown, Globe, Hash, Radio } from "lucide-react";
import { EMPTY_MESSAGES, type ChatMessage } from "@/lib/bitchat/types";

function timeOf(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Render message text with @mentions and #channels highlighted. */
function Content({
  text,
  meNick,
  dim,
}: {
  text: string;
  meNick: string;
  dim?: boolean;
}) {
  const parts = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    const regex = /(@[a-zA-Z0-9_]+)|(#[0-9bcdefghjkmnpqrstuvwxyz]{2,9})/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) nodes.push(text.slice(last, m.index));
      const token = m[0];
      if (m[1] && m[1].slice(1).toLowerCase() === meNick.toLowerCase()) {
        nodes.push(
          <mark
            key={key++}
            className="rounded bg-emerald-500/15 px-0.5 text-emerald-200"
          >
            {token}
          </mark>
        );
      } else {
        nodes.push(
          <span
            key={key++}
            className="text-emerald-300/90 underline decoration-emerald-400/30 underline-offset-2"
          >
            {token}
          </span>
        );
      }
      last = m.index + token.length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
  }, [text, meNick]);

  return <span className={dim ? "text-white/40" : undefined}>{parts}</span>;
}

function Row({ msg, meNick, myId }: { msg: ChatMessage; meNick: string; myId: string }) {
  const mine = msg.senderId === myId;

  if (msg.kind === "system") {
    const isHelp = msg.content.startsWith("commands:");
    return (
      <div className="aether-in px-4 py-[3px] text-[12px] leading-relaxed">
        <span className="mr-2 select-none text-[10px] tabular-nums text-white/30">
          {timeOf(msg.ts)}
        </span>
        {isHelp ? (
          <pre className="inline-block whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-white/50">
            {msg.content}
          </pre>
        ) : (
          <span className="text-white/40">
            <Content text={msg.content} meNick={meNick} dim />
          </span>
        )}
      </div>
    );
  }

  const isEmote = msg.kind === "emote";
  const nickColor = mine ? "#34d399" : peerColor(msg.nickname);
  const isDm = msg.channel.startsWith("dm:");

  return (
    <div
      className={`aether-in group flex gap-2.5 rounded-lg px-4 py-[3px] text-[13.5px] leading-relaxed transition-colors duration-150 hover:bg-white/[0.03] ${
        isEmote ? "italic" : ""
      }`}
    >
      <span
        className="mt-[3px] shrink-0 select-none text-[10px] tabular-nums text-white/35"
        title={new Date(msg.ts).toLocaleString()}
      >
        {timeOf(msg.ts)}
      </span>
      <span className="min-w-0 flex-1 break-words text-white/85">
        {isDm && !isEmote && (
          <span className="mr-1.5 inline-block rounded bg-white/[0.07] px-1 py-px align-[1px] text-[9px] font-semibold uppercase tracking-wide text-white/40">
            pm
          </span>
        )}
        {!isEmote && (
          <>
            <span className="font-semibold" style={{ color: nickColor }}>
              &lt;{msg.nickname}&gt;
            </span>{" "}
          </>
        )}
        <Content text={msg.content} meNick={meNick} />
        {msg.hops !== undefined && msg.hops > 1 && (
          <span
            className="ml-1.5 inline-block rounded bg-white/[0.06] px-1 align-[1px] text-[9px] text-white/40"
            title={`${msg.hops} mesh hops`}
          >
            {msg.hops}h
          </span>
        )}
        {mine && msg.deliveryStatus && (
          <span
            className="ml-1 inline-flex select-none align-middle text-emerald-400/80"
            title={msg.deliveryStatus}
          >
            {msg.deliveryStatus === "sending" ? (
              <span className="text-white/30">…</span>
            ) : (
              <Check className="h-3 w-3" strokeWidth={2.5} />
            )}
          </span>
        )}
      </span>
    </div>
  );
}

export default function MessageList() {
  const activeChannel = useBitchat((s) => s.activeChannel);
  const messages = useBitchat((s) => s.messages[s.activeChannel] ?? EMPTY_MESSAGES);
  const nickname = useBitchat((s) => s.nickname);
  const session = useBitchat((s) => s.session);
  const meta = useBitchat((s) => s.channels.find((c) => c.id === s.activeChannel));
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [newCount, setNewCount] = useState(0);

  // adjust state on channel switch during render (React-sanctioned pattern)
  const [prevChannel, setPrevChannel] = useState(activeChannel);
  if (prevChannel !== activeChannel) {
    setPrevChannel(activeChannel);
    setPinned(true);
    setNewCount(0);
  }

  // track scroll position (external DOM events)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      pinnedRef.current = nearBottom;
      setPinned(nearBottom);
      if (nearBottom) setNewCount(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // auto-scroll to bottom on new messages while pinned (pure DOM sync)
  useEffect(() => {
    const el = containerRef.current;
    if (el && pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // jump to bottom on channel switch (pure DOM sync)
  useEffect(() => {
    pinnedRef.current = true;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeChannel]);

  // count messages arriving while scrolled up (external store subscription)
  useEffect(() => {
    const unsub = useBitchat.subscribe((state, prev) => {
      const ch = state.activeChannel;
      const now = state.messages[ch]?.length ?? 0;
      const before = prev.messages[ch]?.length ?? 0;
      if (now > before && !pinnedRef.current) {
        setNewCount((c) => c + (now - before));
      }
    });
    return unsub;
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        className="aether-scroll h-full overflow-y-auto py-3"
        role="log"
        aria-label={`messages in ${meta?.label ?? activeChannel}`}
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center px-6 pb-6">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/10">
                {meta?.readOnly ? (
                  <Globe className="h-4 w-4 text-white/30" strokeWidth={1.5} />
                ) : (
                  <Radio className="h-4 w-4 text-white/30" strokeWidth={1.5} />
                )}
              </div>
              <p className="text-[13px] leading-5 text-white/50">
                {meta?.readOnly
                  ? "listening to the global feed — real bitchat traffic appears here as it happens"
                  : "no messages yet — say gm, or type /help"}
              </p>
              {!meta?.readOnly && (
                <p className="mt-1 flex items-center justify-center gap-1 text-[11px] text-white/35">
                  <Hash className="h-3 w-3" strokeWidth={1.75} />
                  irc-style commands still work here
                </p>
              )}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Row key={m.id} msg={m} meNick={nickname} myId={session?.sessionId ?? ""} />
        ))}
        <div className="h-1" />
      </div>

      {!pinned && newCount > 0 && (
        <button
          className="aether-in aether-glow absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-[#0c0c0c]/90 py-1.5 pl-3 pr-3.5 text-[11px] font-medium text-emerald-300 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-md transition-all duration-150 hover:border-emerald-400/60"
          onClick={() => {
            const el = containerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            setPinned(true);
            setNewCount(0);
          }}
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
          {newCount} new message{newCount > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
