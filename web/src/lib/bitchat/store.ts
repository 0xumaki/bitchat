"use client";

// bitchat web client store: zustand + socket.io wiring to the relay service

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import {
  channelKindOf,
  channelLabel,
  HELP_TEXT,
  type ChannelMeta,
  type ChatMessage,
  type DmOpenPayload,
  type GeoChannelInfo,
  type Peer,
  type RelayStatus,
  type SessionInfo,
} from "./types";

const NICK_KEY = "bitchat:nickname";

export type Phase = "gate" | "connecting" | "ready";

interface BitchatState {
  phase: Phase;
  connected: boolean;
  nickname: string;
  session: SessionInfo | null;
  relays: RelayStatus[];
  geoChannels: GeoChannelInfo[];
  channels: ChannelMeta[];
  activeChannel: string;
  messages: Record<string, ChatMessage[]>;
  peers: Record<string, Peer[]>;
  unread: Record<string, number>;
  joined: Record<string, boolean>;

  savedNickname: () => string;
  connect: (nickname: string) => void;
  disconnect: () => void;
  setActive: (channel: string) => void;
  joinChannel: (channel: string) => void;
  leaveChannel: (channel: string) => void;
  sendMessage: (content: string) => void;
  clearChannel: (channel: string) => void;
}

let socket: Socket | null = null;
let clientIdCounter = 0;

function getSocket(): Socket {
  if (!socket) {
    // Sandbox gateway: relative path only, port via XTransformPort query.
    // Standalone: set NEXT_PUBLIC_RELAY_URL (e.g. "http://localhost:3003").
    const relayUrl = process.env.NEXT_PUBLIC_RELAY_URL || "/?XTransformPort=3003";
    socket = io(relayUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10_000,
    });
  }
  return socket;
}

function inferMeta(channel: string): ChannelMeta {
  const kind = channelKindOf(channel);
  return { id: channel, kind, label: channelLabel(channel), readOnly: kind === "global" };
}

export const useBitchat = create<BitchatState>((set, get) => ({
  phase: "gate",
  connected: false,
  nickname: "",
  session: null,
  relays: [],
  geoChannels: [],
  channels: [],
  activeChannel: "mesh",
  messages: {},
  peers: {},
  unread: {},
  joined: {},

  savedNickname: () => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(NICK_KEY) ?? "";
    } catch {
      return "";
    }
  },

  connect: (nickname: string) => {
    if (get().phase === "connecting" || get().phase === "ready") return;
    const s = getSocket();
    set({ phase: "connecting", nickname });

    const doHello = () => {
      set({ connected: true });
      s.emit(
        "hello",
        { nickname },
        (res: { ok: boolean; session: SessionInfo; relays: RelayStatus[]; geoChannels: GeoChannelInfo[] }) => {
          if (!res?.ok) return;
          try {
            window.localStorage.setItem(NICK_KEY, res.session.nickname);
          } catch {}
          set({
            phase: "ready",
            session: res.session,
            nickname: res.session.nickname,
            relays: res.relays,
            geoChannels: res.geoChannels,
            channels: [{ id: "mesh", kind: "mesh", label: "#mesh" }],
            activeChannel: "mesh",
            joined: { mesh: true },
          });
          // fetch initial mesh state
          s.emit("join", { channel: "mesh" }, (r: { ok: boolean; history?: ChatMessage[]; peers?: Peer[] }) => {
            if (r?.ok) {
              set((st) => ({
                messages: { ...st.messages, mesh: st.messages.mesh?.length ? st.messages.mesh : r.history ?? [] },
                peers: { ...st.peers, mesh: r.peers ?? [] },
              }));
            }
          });
        }
      );
    };

    s.on("connect", doHello);

    s.on("disconnect", () => set({ connected: false }));

    s.on("message", (msg: ChatMessage) => {
      if (!msg || !msg.channel) return;
      set((st) => {
        // reconcile optimistic message
        const list = st.messages[msg.channel] ?? [];
        let next: ChatMessage[];
        if (msg.clientId && list.some((m) => m.clientId === msg.clientId)) {
          next = list.map((m) => (m.clientId === msg.clientId ? msg : m));
        } else {
          next = [...list, msg].slice(-400);
        }
        const channels = st.channels.some((c) => c.id === msg.channel)
          ? st.channels
          : [...st.channels, inferMeta(msg.channel)];
        const unread =
          msg.channel === st.activeChannel || msg.kind === "system"
            ? st.unread
            : { ...st.unread, [msg.channel]: (st.unread[msg.channel] ?? 0) + 1 };
        return { messages: { ...st.messages, [msg.channel]: next }, channels, unread };
      });
    });

    s.on("peers", ({ channel, peers }: { channel: string; peers: Peer[] }) => {
      set((st) => ({ peers: { ...st.peers, [channel]: peers } }));
    });

    s.on("relay-status", ({ relays }: { relays: RelayStatus[] }) => {
      set({ relays });
    });

    s.on("geo-activity", ({ channels }: { channels: GeoChannelInfo[] }) => {
      set({ geoChannels: channels });
    });

    s.on("dm-open", (d: DmOpenPayload) => {
      set((st) => {
        if (st.channels.some((c) => c.id === d.channel)) return st;
        const kind = d.channel.startsWith("group:") ? "group" : "dm";
        return {
          channels: [...st.channels, { id: d.channel, kind, label: `@${d.nickname}` }],
        };
      });
      // load history for the newly opened chat
      s.emit("join", { channel: d.channel }, (r: { ok: boolean; history?: ChatMessage[]; peers?: Peer[] }) => {
        if (r?.ok) {
          set((st) => ({
            messages: { ...st.messages, [d.channel]: st.messages[d.channel]?.length ? st.messages[d.channel] : r.history ?? [] },
            peers: { ...st.peers, [d.channel]: r.peers ?? [] },
            joined: { ...st.joined, [d.channel]: true },
          }));
        }
      });
    });

    s.on("channel-joined", ({ channel }: { channel: string }) => {
      set((st) => ({ joined: { ...st.joined, [channel]: true } }));
    });

    if (s.connected) doHello();
  },

  disconnect: () => {
    socket?.disconnect();
    socket = null;
  },

  setActive: (channel: string) => {
    const st = get();
    if (!st.joined[channel] && channel !== "mesh") {
      // join on demand
      const s = getSocket();
      s.emit("join", { channel }, (r: { ok: boolean; history?: ChatMessage[]; peers?: Peer[]; readOnly?: boolean }) => {
        if (r?.ok) {
          set((s2) => ({
            joined: { ...s2.joined, [channel]: true },
            messages: { ...s2.messages, [channel]: s2.messages[channel]?.length ? s2.messages[channel] : r.history ?? [] },
            peers: { ...s2.peers, [channel]: r.peers ?? [] },
            channels: s2.channels.some((c) => c.id === channel)
              ? s2.channels
              : [...s2.channels, { ...inferMeta(channel), readOnly: r.readOnly }],
          }));
        }
      });
    }
    set((s) => ({
      activeChannel: channel,
      unread: { ...s.unread, [channel]: 0 },
    }));
  },

  joinChannel: (channel: string) => {
    const s = getSocket();
    s.emit("join", { channel }, (r: { ok: boolean; history?: ChatMessage[]; peers?: Peer[]; error?: string }) => {
      if (!r?.ok) return;
      set((st) => ({
        channels: st.channels.some((c) => c.id === channel)
          ? st.channels
          : [...st.channels, inferMeta(channel)],
        joined: { ...st.joined, [channel]: true },
        messages: { ...st.messages, [channel]: st.messages[channel]?.length ? st.messages[channel] : r.history ?? [] },
        peers: { ...st.peers, [channel]: r.peers ?? [] },
        activeChannel: channel,
        unread: { ...st.unread, [channel]: 0 },
      }));
    });
  },

  leaveChannel: (channel: string) => {
    if (channel === "mesh") return;
    const s = getSocket();
    s.emit("leave", { channel });
    set((st) => {
      const messages = { ...st.messages };
      const peers = { ...st.peers };
      delete messages[channel];
      delete peers[channel];
      const unread = { ...st.unread };
      delete unread[channel];
      const channels = st.channels.filter((c) => c.id !== channel);
      const joined = { ...st.joined };
      delete joined[channel];
      return {
        channels,
        messages,
        peers,
        unread,
        joined,
        activeChannel: st.activeChannel === channel ? "mesh" : st.activeChannel,
      };
    });
  },

  sendMessage: (content: string) => {
    const st = get();
    const channel = st.activeChannel;
    const trimmed = content.trim();
    if (!trimmed) return;

    // client-local commands
    if (trimmed === "/help" || trimmed === "/help *") {
      set((s) => ({
        messages: {
          ...s.messages,
          [channel]: [
            ...(s.messages[channel] ?? []),
            {
              id: `help-${Date.now()}`,
              channel,
              kind: "system",
              senderId: "system",
              nickname: "",
              content: HELP_TEXT,
              ts: Date.now(),
            },
          ],
        },
      }));
      return;
    }
    if (trimmed === "/clear") {
      set((s) => ({ messages: { ...s.messages, [channel]: [] } }));
      return;
    }

    const clientId = `c${Date.now()}-${clientIdCounter++}`;
    // optimistic echo
    if (!trimmed.startsWith("/")) {
      const optimistic: ChatMessage = {
        id: clientId,
        clientId,
        channel,
        kind: "chat",
        senderId: st.session?.sessionId ?? "me",
        nickname: st.nickname,
        content: trimmed,
        ts: Date.now(),
        origin: channel.startsWith("geo:") ? "nostr" : "web",
        deliveryStatus: "sending",
      };
      set((s) => ({
        messages: { ...s.messages, [channel]: [...(s.messages[channel] ?? []), optimistic] },
      }));
    }

    getSocket().emit("send", { channel, content: trimmed, clientId }, (r: { ok: boolean }) => {
      if (!r?.ok) {
        // drop the optimistic message on hard failure
        set((s) => ({
          messages: {
            ...s.messages,
            [channel]: (s.messages[channel] ?? []).filter((m) => m.clientId !== clientId),
          },
        }));
      }
    });
  },

  clearChannel: (channel: string) => {
    set((s) => ({ messages: { ...s.messages, [channel]: [] } }));
  },
}));
