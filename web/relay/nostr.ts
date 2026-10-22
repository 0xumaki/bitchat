// Nostr bridge: connects to the real bitchat relay set, manages live
// subscriptions (geohash channels + global feed), publishes kind-20000
// geohash messages with NIP-13 proof-of-work, and tracks presence.
//
// Wire format (verified live against real bitchat clients):
//   kind 20000 geohash message: tags [["g", geohash], ["n", nickname], (["nonce", n, bits])]
//   kind 20001 presence:        tags [["g", geohash]], content ""

import { sha256 } from "@noble/hashes/sha256";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  serializeEvent,
  verifyEvent,
} from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import type { RelayStatus } from "./types";

export const BUILT_IN_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://offchain.pub",
];

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface GeoMessageEvent {
  event: NostrEvent;
  geohash: string;
  nickname: string | null;
  isPresence: boolean;
  isBridge: boolean;
}

type Handler = (msg: GeoMessageEvent) => void;

interface RelayConn {
  url: string;
  ws: WebSocket | null;
  connected: boolean;
  lastError?: string;
  reconnectTimer: any | null;
  attempts: number;
}

function leadingZeroBits(buf: Uint8Array): number {
  let bits = 0;
  for (const b of buf) {
    if (b === 0) {
      bits += 8;
      continue;
    }
    let v = b,
      n = 0;
    while ((v & 0x80) === 0) {
      n++;
      v <<= 1;
    }
    return bits + n;
  }
  return bits;
}

const utf8 = new TextEncoder();

/** Mine a NIP-13 nonce so the event id has `bits` leading zero bits. */
function mineNonce(
  base: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string },
  bits: number,
  maxIter = 5_000_000
): string[] {
  const nonceTag = ["nonce", "0", String(bits)];
  const tags = [...base.tags, nonceTag];
  for (let i = 0; i < maxIter; i++) {
    nonceTag[1] = String(i);
    const ser = serializeEvent({
      id: "",
      sig: "",
      ...base,
      tags,
    } as any);
    const h = sha256(utf8.encode(ser));
    if (leadingZeroBits(h) >= bits) return nonceTag;
  }
  return nonceTag; // give up, publish unmined rather than stalling
}

export class NostrBridge {
  private relays = new Map<string, RelayConn>();
  private subs = new Map<string, { filters: any[] }>(); // subId -> filters
  private handler: Handler | null = null;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private statusTimer: any = null;

  onEvent(handler: Handler) {
    this.handler = handler;
  }

  start() {
    for (const url of BUILT_IN_RELAYS) {
      this.relays.set(url, {
        url,
        ws: null,
        connected: false,
        reconnectTimer: null,
        attempts: 0,
      });
      this.connect(url);
    }
    this.statusTimer = setInterval(() => this.resubscribeAll(), 30_000);
  }

  status(): RelayStatus[] {
    return [...this.relays.values()].map((r) => ({
      url: r.url,
      connected: r.connected,
      lastError: r.lastError,
    }));
  }

  connectedCount(): number {
    let n = 0;
    for (const r of this.relays.values()) if (r.connected) n++;
    return n;
  }

  private connect(url: string) {
    const conn = this.relays.get(url);
    if (!conn) return;
    try {
      const ws = new WebSocket(url);
      conn.ws = ws;

      ws.onopen = () => {
        conn.connected = true;
        conn.attempts = 0;
        conn.lastError = undefined;
        console.log(`[nostr] connected ${url}`);
        // (re)send all active subscriptions
        for (const [subId, sub] of this.subs) {
          ws.send(JSON.stringify(["REQ", subId, ...sub.filters]));
        }
      };

      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg[0] === "EVENT" && msg[1] && msg[2]) {
          this.handleEvent(msg[2]);
        }
        // OK / NOTICE / CLOSED are ignored (we fire-and-forget publishes)
      };

      ws.onerror = () => {
        conn.lastError = "connection error";
      };

      ws.onclose = () => {
        if (conn.connected) console.log(`[nostr] disconnected ${url}`);
        conn.connected = false;
        conn.ws = null;
        this.scheduleReconnect(url);
      };
    } catch (e: any) {
      conn.lastError = String(e);
      this.scheduleReconnect(url);
    }
  }

  private scheduleReconnect(url: string) {
    const conn = this.relays.get(url);
    if (!conn || conn.reconnectTimer) return;
    const delay = Math.min(2_000 * Math.pow(1.7, conn.attempts), 60_000);
    conn.attempts++;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      this.connect(url);
    }, delay);
  }

  private resubscribeAll() {
    for (const [subId, sub] of this.subs) {
      const payload = JSON.stringify(["REQ", subId, ...sub.filters]);
      for (const r of this.relays.values()) {
        if (r.connected && r.ws) r.ws.send(payload);
      }
    }
  }

  private markSeen(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 8_000) {
      const drop = this.seenOrder.splice(0, 4_000);
      for (const d of drop) this.seen.delete(d);
    }
    return true;
  }

  private handleEvent(ev: NostrEvent) {
    if (!this.markSeen(ev.id)) return;
    // cheap shape check before signature verification
    const gTag = ev.tags.find((t) => t[0] === "g");
    const rTag = ev.tags.find((t) => t[0] === "r");
    if (ev.kind !== 20000 && ev.kind !== 20001) return;
    if (!gTag && !rTag) return;
    if (ev.content.length > 2_000) return;

    let valid = false;
    try {
      valid = verifyEvent(ev as any);
    } catch {
      valid = false;
    }
    if (!valid) return;

    const nTag = ev.tags.find((t) => t[0] === "n");
    this.handler?.({
      event: ev,
      geohash: (gTag?.[1] ?? rTag?.[1] ?? "").toLowerCase(),
      nickname: nTag?.[1] ?? null,
      isPresence: ev.kind === 20001,
      isBridge: !gTag && !!rTag,
    });
  }

  /** Ensure a subscription exists for a geohash channel (or the global feed). */
  subscribeGeohash(geohash: string) {
    const subId = `geo:${geohash}`;
    if (this.subs.has(subId)) return;
    this.subs.set(subId, {
      filters: [{ kinds: [20000, 20001], "#g": [geohash], limit: 0 }],
    });
    this.sendSub(subId);
  }

  unsubscribeGeohash(geohash: string) {
    const subId = `geo:${geohash}`;
    if (!this.subs.has(subId)) return;
    this.subs.delete(subId);
    this.sendClose(subId);
  }

  subscribeGlobal() {
    const subId = "global-feed";
    if (this.subs.has(subId)) return;
    this.subs.set(subId, {
      filters: [{ kinds: [20000, 20001], limit: 0 }],
    });
    this.sendSub(subId);
  }

  private sendSub(subId: string) {
    const sub = this.subs.get(subId)!;
    const payload = JSON.stringify(["REQ", subId, ...sub.filters]);
    for (const r of this.relays.values()) {
      if (r.connected && r.ws) r.ws.send(payload);
    }
  }

  private sendClose(subId: string) {
    const payload = JSON.stringify(["CLOSE", subId]);
    for (const r of this.relays.values()) {
      if (r.connected && r.ws) r.ws.send(payload);
    }
  }

  /** Publish a kind-20000 geohash chat message with mined PoW. Returns the event id (or null). */
  publishGeohashMessage(
    secretKey: Uint8Array,
    geohash: string,
    nickname: string,
    content: string,
    powBits = 16
  ): NostrEvent | null {
    const pubkey = getPublicKey(secretKey);
    const base = {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 20000,
      tags: [
        ["g", geohash],
        ["n", nickname],
      ],
      content,
    };
    const nonceTag = mineNonce(base, powBits);
    const template = { ...base, tags: [...base.tags, nonceTag] };
    const signed = finalizeEvent(template, secretKey) as NostrEvent;
    // mark as seen so the relay echo of our own event does not duplicate
    this.markSeen(signed.id);
    this.publishEvent(signed);
    return signed;
  }

  /** Publish a kind-20001 presence heartbeat for a geohash. */
  publishPresence(secretKey: Uint8Array, geohash: string): NostrEvent | null {
    try {
      const template = {
        kind: 20001,
        tags: [["g", geohash]],
        content: "",
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = finalizeEvent(template, secretKey) as NostrEvent;
      this.publishEvent(signed);
      return signed;
    } catch (e) {
      console.error("[nostr] presence publish failed", e);
      return null;
    }
  }

  private publishEvent(ev: NostrEvent) {
    const payload = JSON.stringify(["EVENT", ev]);
    for (const r of this.relays.values()) {
      if (r.connected && r.ws) {
        try {
          r.ws.send(payload);
        } catch {}
      }
    }
  }

  npub(pubkey: string): string {
    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return pubkey;
    }
  }
}

export { generateSecretKey, getPublicKey };
