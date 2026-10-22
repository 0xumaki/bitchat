"use client";

import { useState } from "react";
import { useBitchat } from "@/lib/bitchat/store";
import AetherCanvas from "./AetherCanvas";
import {
  ArrowRight,
  Fingerprint,
  Globe2,
  Radio,
  ShieldCheck,
} from "lucide-react";

const CHIPS = [
  { icon: ShieldCheck, label: "no accounts" },
  { icon: Fingerprint, label: "no phone numbers" },
  { icon: Globe2, label: "no servers" },
] as const;

export default function NicknameGate() {
  const connect = useBitchat((s) => s.connect);
  const phase = useBitchat((s) => s.phase);
  const [nick, setNick] = useState("");
  const suggestion = `anon${Math.floor(1000 + Math.random() * 9000)}`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    connect(nick.trim() || suggestion);
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#080808] px-4 py-10 font-sans text-white">
      <AetherCanvas />
      {/* ambient emerald aura */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(58% 46% at 50% 0%, rgba(16,185,129,0.08), transparent 70%)",
        }}
      />

      <div className="aether-in relative z-10 w-full max-w-sm">
        {/* brand */}
        <div className="mb-8 text-center">
          <div className="aether-glow mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-400/30">
            <Radio className="h-5 w-5 text-emerald-400" strokeWidth={1.75} />
          </div>
          <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em]">
            bitchat
            <span className="blink ml-0.5 align-[0.05em] text-emerald-400">▌</span>
          </h1>
          <p className="mt-2 text-sm leading-5 text-white/50">
            decentralized mesh chat — irc vibes
          </p>
        </div>

        {/* glass card in a gradient border shell */}
        <div className="aether-shell">
          <div className="aether-surface p-7">
            <form onSubmit={submit}>
              <label
                htmlFor="nickname"
                className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40"
              >
                choose a nickname
              </label>
              <div className="group flex items-center gap-0.5 rounded-2xl border border-white/10 bg-white/[0.04] transition-all duration-150 focus-within:border-emerald-400/60 focus-within:ring-2 focus-within:ring-emerald-400/15">
                <span
                  className="select-none pl-4 text-sm text-white/30 transition-colors duration-150 group-focus-within:text-emerald-400/70"
                  aria-hidden="true"
                >
                  @
                </span>
                <input
                  id="nickname"
                  value={nick}
                  onChange={(e) =>
                    setNick(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16))
                  }
                  placeholder={suggestion}
                  suppressHydrationWarning
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent py-2.5 pr-4 pl-1.5 text-sm text-white outline-none placeholder:text-white/25"
                />
              </div>
              <button
                type="submit"
                disabled={phase === "connecting"}
                className="aether-glow-hover mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-emerald-500 py-2.5 text-sm font-semibold text-[#080808] transition-all duration-150 hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-50"
              >
                {phase === "connecting" ? (
                  <>
                    <span className="aether-pulse-dot h-1.5 w-1.5 rounded-full bg-[#080808]" />
                    entering the mesh…
                  </>
                ) : (
                  <>
                    enter the mesh
                    <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
              {CHIPS.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/50"
                >
                  <Icon className="h-3 w-3 text-emerald-400/80" strokeWidth={1.75} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/40">
          your identity is an ephemeral key generated on this device and stays
          here. the #mesh channel is a local simulation — geo channels bridge to
          live nostr relays used by real bitchat apps.
        </p>
      </div>
    </div>
  );
}
