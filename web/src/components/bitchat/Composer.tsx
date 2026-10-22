"use client";

import { useMemo, useRef, useState } from "react";
import { useBitchat } from "@/lib/bitchat/store";
import { EMPTY_PEERS } from "@/lib/bitchat/types";
import { ArrowUp, EyeOff } from "lucide-react";

interface Hint {
  label: string;
  desc: string;
}

const COMMANDS: Hint[] = [
  { label: "/msg", desc: "@name [message] — private chat" },
  { label: "/who", desc: "— list who's here" },
  { label: "/clear", desc: "— clear this chat" },
  { label: "/hug", desc: "@name — send a hug" },
  { label: "/slap", desc: "@name — slap with a large trout" },
  { label: "/block", desc: "@name — block a peer" },
  { label: "/unblock", desc: "@name — unblock" },
  { label: "/fav", desc: "@name — favorite (mesh)" },
  { label: "/unfav", desc: "@name — unfavorite" },
  { label: "/group", desc: "create|invite|remove|leave|list" },
  { label: "/ping", desc: "@name — round-trip time (mesh)" },
  { label: "/trace", desc: "@name — mesh path (mesh)" },
  { label: "/pay", desc: "<token> — attach ecash" },
  { label: "/drop", desc: "<message> — pin a note for 24h" },
  { label: "/join", desc: "<geohash> — live location channel" },
  { label: "/nick", desc: "<name> — change nickname" },
  { label: "/help", desc: "— this list" },
];

export default function Composer() {
  const sendMessage = useBitchat((s) => s.sendMessage);
  const activeChannel = useBitchat((s) => s.activeChannel);
  const channels = useBitchat((s) => s.channels);
  const peers = useBitchat((s) => s.peers[s.activeChannel] ?? EMPTY_PEERS);
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const meta = channels.find((c) => c.id === activeChannel);
  const readOnly = meta?.readOnly ?? false;

  const hints = useMemo<Hint[]>(() => {
    if (value.startsWith("/") && !value.includes(" ")) {
      const q = value.slice(1).toLowerCase();
      return COMMANDS.filter((c) => c.label.slice(1).startsWith(q)).slice(0, 8);
    }
    const atMatch = /(?:^|\s)@([a-z0-9_]*)$/i.exec(value);
    if (atMatch) {
      const q = atMatch[1].toLowerCase();
      return peers
        .filter((p) => p.nickname.toLowerCase().startsWith(q))
        .slice(0, 8)
        .map((p) => ({
          label: `@${p.nickname}`,
          desc:
            p.origin === "nostr"
              ? "nostr peer"
              : p.origin === "mesh"
                ? "mesh peer"
                : "web peer",
        }));
    }
    return [];
  }, [value, peers]);

  const NICK_COMMANDS = new Set([
    "/msg",
    "/hug",
    "/slap",
    "/block",
    "/unblock",
    "/fav",
    "/unfav",
    "/ping",
    "/trace",
  ]);

  const applyHint = (hint: Hint) => {
    if (value.startsWith("/") && !value.includes(" ")) {
      setValue(hint.label + (NICK_COMMANDS.has(hint.label) ? " @" : " "));
    } else {
      setValue(value.replace(/@([a-z0-9_]*)$/i, hint.label + " "));
    }
    inputRef.current?.focus();
  };

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    setValue("");
    sendMessage(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (hints.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (s + 1) % hints.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (s - 1 + hints.length) % hints.length);
        return;
      }
      // Enter submits when the typed command is already complete;
      // otherwise (or on Tab) it completes the suggestion
      const exactMatch = hints.length === 1 && hints[0].label === value.trim();
      const shouldComplete =
        e.key === "Tab" ||
        (e.key === "Enter" &&
          value.startsWith("/") &&
          !value.includes(" ") &&
          hints.length === 1 &&
          !exactMatch);
      if (shouldComplete) {
        e.preventDefault();
        applyHint(hints[selected]);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  if (readOnly) {
    return (
      <div className="shrink-0 border-t border-white/[0.08] bg-black/25 px-4 py-2.5">
        <div className="flex items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-2.5 text-[12px] text-white/40">
          <EyeOff className="h-3.5 w-3.5 text-white/30" strokeWidth={1.75} />
          read-only feed — join a #geohash channel to talk
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-white/[0.08] bg-black/25 px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="relative">
        {hints.length > 0 && (
          <div className="aether-in absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d]/95 shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-xl">
            {hints.map((h, i) => (
              <button
                key={h.label}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12px] transition-colors duration-150 ${
                  i === selected
                    ? "bg-emerald-500/10 text-emerald-200"
                    : "text-white/60 hover:bg-white/[0.04]"
                }`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => applyHint(h)}
              >
                <span className="font-semibold">{h.label}</span>
                <span className="truncate text-white/35">{h.desc}</span>
              </button>
            ))}
          </div>
        )}

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex min-h-10 flex-1 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 transition-all duration-150 focus-within:border-emerald-400/50 focus-within:ring-2 focus-within:ring-emerald-400/15">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSelected(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={
                activeChannel === "mesh"
                  ? "message #mesh — /help for commands"
                  : "message"
              }
              className="min-w-0 flex-1 bg-transparent py-2 text-[13.5px] text-white outline-none placeholder:text-white/25 caret-emerald-400"
              autoComplete="off"
              spellCheck={false}
              maxLength={500}
              aria-label="message input"
            />
          </div>
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="send message"
            className="aether-glow-hover flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[#080808] transition-all duration-150 hover:bg-emerald-400 active:scale-95 disabled:opacity-25 disabled:shadow-none"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </form>
      </div>
    </div>
  );
}
