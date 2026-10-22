// Shared client-side types mirroring the bitchat-relay service contract

export type MessageKind = "chat" | "system" | "emote" | "presence";
export type MessageOrigin = "mesh" | "nostr" | "web" | "bridge";
export type DeliveryStatus = "sending" | "sent" | "delivered";

export interface ChatMessage {
  id: string;
  channel: string;
  kind: MessageKind;
  senderId: string;
  nickname: string;
  content: string;
  ts: number;
  origin?: MessageOrigin;
  deliveryStatus?: DeliveryStatus;
  clientId?: string;
  hops?: number;
}

export interface Peer {
  id: string;
  nickname: string;
  origin: "mesh" | "web" | "nostr";
  hops?: number;
  lastSeen: number;
}

export interface RelayStatus {
  url: string;
  connected: boolean;
  lastError?: string;
}

export interface GeoChannelInfo {
  geohash: string;
  label?: string;
  count: number;
  lastTs: number;
}

export interface SessionInfo {
  sessionId: string;
  nickname: string;
  npub: string;
}

export type ChannelKind = "mesh" | "global" | "geo" | "dm" | "group";

/** Stable empty fallbacks — zustand selectors must return cached references. */
export const EMPTY_MESSAGES: ChatMessage[] = [];
export const EMPTY_PEERS: Peer[] = [];

export interface ChannelMeta {
  id: string;
  kind: ChannelKind;
  label: string;
  readOnly?: boolean;
}

export interface DmOpenPayload {
  channel: string;
  peerId: string;
  nickname: string;
}

export const HELP_TEXT = `commands:
/msg @name [message] — start a private chat
/who — list who's here
/clear — clear this chat
/hug @name — send a hug
/slap @name — slap with a large trout
/block @name · /unblock @name
/fav @name · /unfav @name — favorites (mesh only)
/group create <name> — start an encrypted group
/group invite @name · /group remove @name — manage members (creator)
/group leave · /group list — leave or list your groups
/ping @name — measure round-trip time (mesh only)
/trace @name — estimated mesh path (mesh only)
/pay <token> — send a cashu ecash token in this chat
/drop <message> — pin a note to this place for 24h
web extras:
/join <geohash> — join a live location channel (e.g. /join dr5rs)
/nick <name> — change your nickname
/help — this list`;

export function channelLabel(channel: string): string {
  if (channel === "mesh") return "#mesh";
  if (channel === "global") return "#global";
  if (channel.startsWith("geo:")) return `#${channel.slice(4)}`;
  if (channel.startsWith("group:")) return `#${channel.slice(6)} (group)`;
  if (channel.startsWith("dm:")) return "pm";
  return channel;
}

export function channelKindOf(channel: string): ChannelKind {
  if (channel === "mesh") return "mesh";
  if (channel === "global") return "global";
  if (channel.startsWith("geo:")) return "geo";
  if (channel.startsWith("group:")) return "group";
  return "dm";
}
