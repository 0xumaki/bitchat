// Shared types for the bitchat web relay

export type ChannelKind =
  | "mesh" // simulated BLE mesh (local only)
  | "global" // aggregate live feed of ALL geohash traffic (read-only)
  | "geo" // real nostr geohash channel (live publish)
  | "dm" // private 1:1 (web sessions / bots, local relay)
  | "group"; // mesh groups (local)

export interface ChatMessage {
  id: string;
  /** channel id: "mesh" | "global" | "geo:<geohash>" | "dm:<a>:<b>" | "group:<name>" */
  channel: string;
  kind: "chat" | "system" | "emote" | "presence";
  /** "bot:xxx" | socket session id | nostr pubkey | "system" */
  senderId: string;
  nickname: string;
  content: string;
  /** epoch ms */
  ts: number;
  origin?: "mesh" | "nostr" | "web" | "bridge";
  deliveryStatus?: "sending" | "sent" | "delivered";
  /** client-supplied id for optimistic reconciliation */
  clientId?: string;
  /** mesh hop count */
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

export const MESH_CHANNEL = "mesh";
export const GLOBAL_CHANNEL = "global";

export function geoChannel(geohash: string): string {
  return `geo:${geohash}`;
}

export function dmChannel(a: string, b: string): string {
  return `dm:${[a, b].sort().join(":")}`;
}

export function groupChannel(name: string): string {
  return `group:${name.toLowerCase()}`;
}

/** IRC-style help text, faithful to bitchat's CommandProcessor.helpText */
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
/drop <message> — pin a note to this place for 24h (needs location)
web extras:
/join <geohash> — join a live location channel (e.g. /join dr5rs)
/nick <name> — change your nickname
/help — this list`;
