// bitchat web relay — main service
//
// Socket.io gateway (port 3003) that glues together:
//   • the simulated BLE mesh (mesh.ts)
//   • the real Nostr relay bridge (nostr.ts) for live geohash channels
//   • per-session ephemeral identities (secp256k1, like bitchat)
//   • IRC-style command processing (faithful to CommandProcessor.swift)
//   • sqlite history (store.ts)

import { createServer } from "node:http";
import { Server } from "socket.io";
import { NostrBridge, generateSecretKey, getPublicKey } from "./nostr";
import { MeshSimulator } from "./mesh";
import { history, saveMessage, startupPurge, trim } from "./store";
import {
  HELP_TEXT,
  MESH_CHANNEL,
  GLOBAL_CHANNEL,
  dmChannel,
  geoChannel,
  groupChannel,
  type ChatMessage,
  type GeoChannelInfo,
  type Peer,
  type SessionInfo,
} from "./types";
import { PRESET_GEO_CHANNELS, isValidGeohash } from "./geo";

const PORT = 3003;
const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

// ---------------------------------------------------------------------------
// state

interface Session {
  socketId: string;
  nickname: string;
  secretKey: Uint8Array;
  pubkey: string;
  npub: string;
  channels: Set<string>;
  blocked: Set<string>; // lowercase nicknames
  favorites: Set<string>; // lowercase nicknames
  lastSend: number;
}

const sessions = new Map<string, Session>(); // socketId -> session
const channels = new Map<string, Set<string>>(); // channel -> socketIds
const nickIndex = new Map<string, string>(); // lowercase nickname -> socketId

// geohash presence from nostr: geohash -> pubkey -> {nickname, lastSeen}
const geoPresence = new Map<string, Map<string, { nickname: string | null; lastSeen: number }>>();
// geohash activity from the global feed (last 30 min)
const geoActivity = new Map<string, { count: number; lastTs: number }>();
// groups: channel -> {name, creator, members(socketIds), bots(bot ids)}
const groups = new Map<
  string,
  { name: string; creator: string; members: Set<string>; bots: Set<string> }
>();

const nostr = new NostrBridge();
const mesh = new MeshSimulator();

// ---------------------------------------------------------------------------
// helpers

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sysMsg(channel: string, content: string, origin: ChatMessage["origin"] = "web"): ChatMessage {
  return {
    id: uid("sys"),
    channel,
    kind: "system",
    senderId: "system",
    nickname: "",
    content,
    ts: Date.now(),
    origin,
  };
}

function getSessionsIn(channel: string): Session[] {
  const ids = channels.get(channel);
  if (!ids) return [];
  const out: Session[] = [];
  for (const id of ids) {
    const s = sessions.get(id);
    if (s) out.push(s);
  }
  return out;
}

function emitTo(session: Session, event: string, payload: any) {
  io.to(session.socketId).emit(event, payload);
}

function notice(session: Session, channel: string, content: string) {
  emitTo(session, "message", sysMsg(channel, content));
}

/** Broadcast a message to every session in a channel, honoring blocks. */
function broadcast(msg: ChatMessage, exceptSocketId?: string) {
  for (const s of getSessionsIn(msg.channel)) {
    if (s.socketId === exceptSocketId) continue;
    if (msg.nickname && s.blocked.has(msg.nickname.toLowerCase())) continue;
    if (s.blocked.has(msg.senderId)) continue;
    emitTo(s, "message", msg);
  }
  saveMessage(msg);
}

function pushPeers(channel: string) {
  const peers = computePeers(channel);
  for (const s of getSessionsIn(channel)) {
    emitTo(s, "peers", { channel, peers: peers.filter((p) => p.id !== s.socketId) });
  }
}

function computePeers(channel: string): Peer[] {
  if (channel === MESH_CHANNEL) {
    const webPeers = getSessionsIn(channel).map((s) => ({
      id: s.socketId,
      nickname: s.nickname,
      origin: "web" as const,
      hops: 1,
      lastSeen: Date.now(),
    }));
    return [...mesh.peers(), ...webPeers];
  }
  if (channel === GLOBAL_CHANNEL) return [];
  if (channel.startsWith("geo:")) {
    const geohash = channel.slice(4);
    const now = Date.now();
    const pres = geoPresence.get(geohash);
    const peers: Peer[] = [];
    if (pres) {
      for (const [pubkey, info] of pres) {
        if (now - info.lastSeen > 5 * 60_000) continue;
        peers.push({
          id: pubkey,
          nickname: info.nickname ?? `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`,
          origin: "nostr",
          lastSeen: info.lastSeen,
        });
      }
    }
    for (const s of getSessionsIn(channel)) {
      peers.push({ id: s.socketId, nickname: s.nickname, origin: "web", lastSeen: now });
    }
    return peers;
  }
  if (channel.startsWith("dm:")) {
    const parts = channel.slice(3).split(":");
    const peers: Peer[] = [];
    for (const p of parts) {
      const s = sessions.get(p);
      if (s) peers.push({ id: s.socketId, nickname: s.nickname, origin: "web", lastSeen: Date.now() });
      else if (p.startsWith("bot:")) {
        const nick = p.slice(4);
        if (mesh.isBotOnline(p))
          peers.push({ id: p, nickname: nick, origin: "mesh", hops: mesh.hopCount(nick), lastSeen: Date.now() });
      }
    }
    return peers;
  }
  if (channel.startsWith("group:")) {
    const g = groups.get(channel);
    if (!g) return [];
    const now = Date.now();
    const peers: Peer[] = [];
    for (const m of g.members) {
      const s = sessions.get(m);
      if (s) peers.push({ id: s.socketId, nickname: s.nickname, origin: "web", lastSeen: now });
    }
    for (const b of g.bots) {
      const nick = b.slice(4);
      peers.push({ id: b, nickname: nick, origin: "mesh", hops: mesh.hopCount(nick), lastSeen: now });
    }
    return peers;
  }
  return [];
}

function joinChannel(session: Session, channel: string) {
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel)!.add(session.socketId);
  session.channels.add(channel);
}

function leaveChannel(session: Session, channel: string) {
  const set = channels.get(channel);
  if (set) {
    set.delete(session.socketId);
    if (set.size === 0) {
      channels.delete(channel);
      if (channel.startsWith("geo:")) nostr.unsubscribeGeohash(channel.slice(4));
    }
  }
  session.channels.delete(channel);
}

function normalizeNickname(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 16);
}

function resolveNickname(nick: string): { kind: "web"; session: Session } | { kind: "bot"; botId: string } | null {
  const n = nick.toLowerCase().replace(/^@/, "");
  const sid = nickIndex.get(n);
  if (sid) {
    const s = sessions.get(sid);
    if (s) return { kind: "web", session: s };
  }
  const bot = mesh.botByNickname(n);
  if (bot && bot.online) return { kind: "bot", botId: bot.id };
  return null;
}

function geoActivityList(): GeoChannelInfo[] {
  const now = Date.now();
  const out: GeoChannelInfo[] = PRESET_GEO_CHANNELS.map((p) => ({
    geohash: p.geohash,
    label: p.label,
    count: 0,
    lastTs: 0,
  }));
  for (const [geohash, info] of geoActivity) {
    if (now - info.lastTs > 30 * 60_000) {
      geoActivity.delete(geohash);
      continue;
    }
    out.push({ geohash, count: info.count, lastTs: info.lastTs });
  }
  out.sort((a, b) => b.lastTs - a.lastTs || b.count - a.count);
  return out.slice(0, 16);
}

let lastActivityBroadcast = 0;
function broadcastGeoActivity(force = false) {
  const now = Date.now();
  if (!force && now - lastActivityBroadcast < 10_000) return;
  lastActivityBroadcast = now;
  io.emit("geo-activity", { channels: geoActivityList() });
}

let lastRelayBroadcast = 0;
function broadcastRelayStatus() {
  const now = Date.now();
  if (now - lastRelayBroadcast < 3_000) return;
  lastRelayBroadcast = now;
  const relays = nostr.status();
  io.emit("relay-status", { relays });
  // if any relay just came online, backfill presence/geo-activity is automatic via resub
}

// ---------------------------------------------------------------------------
// nostr wiring

nostr.onEvent(({ event, geohash, nickname, isPresence, isBridge }) => {
  const shortId = `${event.pubkey.slice(0, 4)}…${event.pubkey.slice(-4)}`;

  if (isPresence) {
    if (!geohash) return;
    if (!geoPresence.has(geohash)) geoPresence.set(geohash, new Map());
    const cell = geoPresence.get(geohash)!;
    const existing = cell.get(event.pubkey);
    if (nickname && !existing?.nickname) {
      // learn nickname from presence only if it carries one (rare) — never overwrite
      cell.set(event.pubkey, { nickname: existing?.nickname ?? null, lastSeen: Date.now() });
    } else {
      cell.set(event.pubkey, { nickname: existing?.nickname ?? null, lastSeen: Date.now() });
    }
    // learn nickname for all cells from message n-tags happens below; presence itself stays quiet
    pushPeersThrottled(geoChannel(geohash));
    return;
  }

  // kind 20000 message
  if (!geohash) return;

  // activity + nickname learning
  if (!geoActivity.has(geohash)) geoActivity.set(geohash, { count: 0, lastTs: Date.now() });
  geoActivity.get(geohash)!.count++;
  geoActivity.get(geohash)!.lastTs = Date.now();
  if (nickname?.trim()) {
    if (!geoPresence.has(geohash)) geoPresence.set(geohash, new Map());
    const cell = geoPresence.get(geohash)!;
    const existing = cell.get(event.pubkey);
    cell.set(event.pubkey, { nickname: nickname.trim(), lastSeen: Date.now() });
    void existing;
  }
  broadcastGeoActivity();

  const displayNick = nickname?.trim() ? nickname.trim() : shortId;
  const content = event.content.trim();
  if (!content) return;

  const origin: ChatMessage["origin"] = isBridge ? "bridge" : "nostr";

  // route to the geohash channel
  const chan = geoChannel(geohash);
  if (channels.has(chan)) {
    const msg: ChatMessage = {
      id: event.id,
      channel: chan,
      kind: "chat",
      senderId: event.pubkey,
      nickname: displayNick,
      content,
      ts: event.created_at * 1000,
      origin,
    };
    broadcast(msg);
    trim(chan);
  }

  // mirror into the global feed
  if (channels.has(GLOBAL_CHANNEL)) {
    const globalMsg: ChatMessage = {
      id: `g-${event.id}`,
      channel: GLOBAL_CHANNEL,
      kind: "chat",
      senderId: event.pubkey,
      nickname: displayNick,
      content: `#${geohash} · ${content}`,
      ts: event.created_at * 1000,
      origin,
    };
    broadcast(globalMsg);
  }
});

const peersThrottle = new Map<string, number>();
function pushPeersThrottled(channel: string) {
  if (!channels.has(channel)) return;
  const now = Date.now();
  const last = peersThrottle.get(channel) ?? 0;
  if (now - last < 5_000) return;
  peersThrottle.set(channel, now);
  pushPeers(channel);
}

// mesh wiring
mesh.start((msg) => {
  broadcast(msg);
}, () => {
  pushPeers(MESH_CHANNEL);
  // groups containing bots also see presence changes
  for (const chan of channels.keys()) {
    if (chan.startsWith("group:")) pushPeersThrottled(chan);
  }
});

// group bot chatter
setInterval(() => {
  for (const [chan, group] of groups) {
    if (group.bots.size === 0) continue;
    if (Math.random() > 0.12) continue;
    const msg = mesh.groupChatter(chan);
    if (msg) broadcast(msg);
  }
}, 30_000);

// presence heartbeat for joined geo channels
setInterval(() => {
  if (nostr.connectedCount() === 0) return;
  for (const s of sessions.values()) {
    for (const chan of s.channels) {
      if (chan.startsWith("geo:")) {
        nostr.publishPresence(s.secretKey, chan.slice(4));
      }
    }
  }
}, 90_000);

setInterval(broadcastRelayStatus, 20_000);

// ---------------------------------------------------------------------------
// commands

function handleCommand(session: Session, channel: string, raw: string) {
  const parts = raw.split(" ");
  const cmd = parts[0].toLowerCase();
  const args = raw.slice(cmd.length).trim();
  const inMesh = channel === MESH_CHANNEL || channel.startsWith("group:");
  const inGeo = channel.startsWith("geo:");

  switch (cmd) {
    case "/msg":
    case "/m": {
      const [target, ...rest] = args.split(" ");
      if (!target) return notice(session, channel, "usage: /msg @nickname [message]");
      const resolved = resolveNickname(target);
      if (!resolved) return notice(session, channel, `'${target.replace(/^@/, "")}' not found`);
      const peerId = resolved.kind === "web" ? resolved.session.socketId : resolved.botId;
      const peerNick = resolved.kind === "web" ? resolved.session.nickname : resolved.botId.slice(4);
      const dm = dmChannel(session.socketId, peerId);
      joinChannel(session, dm);
      if (resolved.kind === "web") joinChannel(resolved.session, dm);
      emitTo(session, "dm-open", { channel: dm, peerId, nickname: peerNick });
      if (resolved.kind === "web") emitTo(resolved.session, "dm-open", { channel: dm, peerId: session.socketId, nickname: session.nickname });
      notice(session, dm, `started private chat with ${peerNick}`);
      if (resolved.kind === "web") notice(resolved.session, dm, `${session.nickname} started a private chat with you`);
      if (rest.length) {
        const content = rest.join(" ");
        const msg: ChatMessage = {
          id: uid("dm"),
          channel: dm,
          kind: "chat",
          senderId: session.socketId,
          nickname: session.nickname,
          content,
          ts: Date.now(),
          origin: "web",
          deliveryStatus: "sent",
        };
        emitTo(session, "message", msg);
        saveMessage(msg);
        if (resolved.kind === "web") {
          if (!resolved.session.blocked.has(session.nickname.toLowerCase())) {
            emitTo(resolved.session, "message", msg);
          }
        } else {
          const reply = mesh.replyToDm(resolved.botId, dm);
          if (reply) setTimeout(() => broadcast(reply), 900 + Math.random() * 1600);
        }
      }
      return;
    }

    case "/who":
    case "/w": {
      const peers = computePeers(channel).filter((p) => p.id !== session.socketId);
      const names = peers.map((p) => p.nickname);
      if (channel.startsWith("geo:")) {
        const nostrPeers = peers.filter((p) => p.origin === "nostr");
        const webPeers = peers.filter((p) => p.origin === "web");
        const parts_: string[] = [];
        if (webPeers.length) parts_.push(webPeers.map((p) => p.nickname).join(", "));
        if (nostrPeers.length) parts_.push(`${nostrPeers.map((p) => p.nickname).join(", ")} (nostr)`);
        return notice(
          session,
          channel,
          parts_.length ? `online: ${parts_.join(" · ")}` : "no one else is online right now"
        );
      }
      if (!names.length) return notice(session, channel, "no one else is online right now");
      return notice(session, channel, `online: ${[...new Set(names)].sort().join(", ")}`);
    }

    case "/slap":
    case "/hug": {
      if (!args) return notice(session, channel, `usage: ${cmd} <nickname>`);
      const nick = args.toLowerCase().replace(/^@/, "");
      const resolved = resolveNickname(nick);
      if (!resolved) return notice(session, channel, `cannot ${cmd.slice(1)} ${nick}: not found`);
      const isSlap = cmd === "/slap";
      const suffix = isSlap ? " around a bit with a large trout" : "";
      const emoji = isSlap ? "🐟" : "🫂";
      const emoteContent = inGeo
        ? `* ${emoji} ${session.nickname} ${isSlap ? "slaps" : "hugs"} ${nick}${suffix} *`
        : `${emoji} ${session.nickname} ${isSlap ? "slaps" : "hugs"} ${nick}${suffix}`;
      sendMessage(session, channel, emoteContent, "emote");
      if (resolved.kind === "bot") {
        if (isSlap) mesh.reactToSlap(resolved.botId, session.nickname);
        else mesh.reactToHug(resolved.botId);
      }
      return;
    }

    case "/block": {
      if (!args) {
        const blocked = [...session.blocked];
        return notice(session, channel, blocked.length ? `blocked: ${blocked.join(", ")}` : "no one is blocked");
      }
      const nick = args.toLowerCase().replace(/^@/, "");
      session.blocked.add(nick);
      return notice(session, channel, `blocked ${nick}`);
    }

    case "/unblock": {
      if (!args) return notice(session, channel, "usage: /unblock @name");
      const nick = args.toLowerCase().replace(/^@/, "");
      session.blocked.delete(nick);
      return notice(session, channel, `unblocked ${nick}`);
    }

    case "/fav":
    case "/unfav": {
      if (!inMesh) return notice(session, channel, "favorites are only for mesh peers in #mesh");
      if (!args) return notice(session, channel, `usage: ${cmd} @name`);
      const nick = args.toLowerCase().replace(/^@/, "");
      if (cmd === "/fav") {
        session.favorites.add(nick);
        return notice(session, channel, `★ favorited ${nick}`);
      }
      session.favorites.delete(nick);
      return notice(session, channel, `unfavorited ${nick}`);
    }

    case "/group": {
      if (inGeo) return notice(session, channel, "groups are only for mesh peers in #mesh");
      const [sub, ...rest] = args.split(" ");
      switch ((sub ?? "").toLowerCase()) {
        case "create": {
          const name = rest.join(" ").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
          if (!name) return notice(session, channel, "usage: /group create <name>");
          const chan = groupChannel(name);
          if (groups.has(chan)) return notice(session, channel, `group '${name}' already exists`);
          groups.set(chan, { name, creator: session.socketId, members: new Set([session.socketId]), bots: new Set() });
          joinChannel(session, chan);
          emitTo(session, "dm-open", { channel: chan, peerId: "system", nickname: `#${name} (group)` });
          return notice(session, chan, `group '${name}' created — invite peers with /group invite @name`);
        }
        case "invite": {
          const chan = currentGroup(session, channel);
          if (!chan) return notice(session, channel, "usage: /group invite @name (from inside your group)");
          const g = groups.get(chan)!;
          if (g.creator !== session.socketId) return notice(session, chan, "only the creator can invite");
          const nick = rest.join(" ").toLowerCase().replace(/^@/, "");
          const resolved = resolveNickname(nick);
          if (!resolved) return notice(session, chan, `'${nick}' not found`);
          if (resolved.kind === "web") {
            joinChannel(resolved.session, chan);
            g.members.add(resolved.session.socketId);
            emitTo(resolved.session, "dm-open", { channel: chan, peerId: "system", nickname: `#${g.name} (group)` });
            notice(resolved.session, chan, `${session.nickname} invited you to group '${g.name}'`);
          } else {
            g.bots.add(resolved.botId);
          }
          broadcast(sysMsg(chan, `${nick} joined the group`));
          pushPeers(chan);
          return;
        }
        case "remove": {
          const chan = currentGroup(session, channel);
          if (!chan) return notice(session, channel, "usage: /group remove @name (from inside your group)");
          const g = groups.get(chan)!;
          if (g.creator !== session.socketId) return notice(session, chan, "only the creator can remove");
          const nick = rest.join(" ").toLowerCase().replace(/^@/, "");
          const resolved = resolveNickname(nick);
          if (!resolved) return notice(session, chan, `'${nick}' not found`);
          if (resolved.kind === "web") {
            g.members.delete(resolved.session.socketId);
            leaveChannel(resolved.session, chan);
            notice(resolved.session, chan, `you were removed from group '${g.name}'`);
          } else {
            g.bots.delete(resolved.botId);
          }
          broadcast(sysMsg(chan, `${nick} was removed from the group`));
          pushPeers(chan);
          return;
        }
        case "leave": {
          const chan = currentGroup(session, channel);
          if (!chan) return notice(session, channel, "you're not in a group");
          const g = groups.get(chan)!;
          g.members.delete(session.socketId);
          leaveChannel(session, chan);
          broadcast(sysMsg(chan, `${session.nickname} left the group`));
          if (g.members.size === 0 && g.bots.size === 0) groups.delete(chan);
          return;
        }
        case "list": {
          const mine = [...groups.values()].filter((g) => g.members.has(session.socketId));
          return notice(
            session,
            channel,
            mine.length ? `your groups: ${mine.map((g) => `#${g.name}`).join(", ")}` : "no groups — /group create <name>"
          );
        }
        default:
          return notice(session, channel, "usage: /group create|invite|remove|leave|list");
      }
    }

    case "/ping": {
      if (!inMesh) return notice(session, channel, "ping only works for mesh peers in #mesh");
      if (!args) return notice(session, channel, "usage: /ping @name");
      const resolved = resolveNickname(args);
      if (!resolved) return notice(session, channel, `'${args.replace(/^@/, "")}' not found`);
      const hops = resolved.kind === "bot" ? mesh.hopCount(resolved.botId.slice(4)) : 1;
      const rtt = Math.round(28 + hops * 47 + Math.random() * 90);
      return notice(session, channel, `pong: ${args.replace(/^@/, "")} ${rtt}ms (${hops} hop${hops > 1 ? "s" : ""})`);
    }

    case "/trace": {
      if (!inMesh) return notice(session, channel, "trace only works for mesh peers in #mesh");
      if (!args) return notice(session, channel, "usage: /trace @name");
      const resolved = resolveNickname(args);
      if (!resolved) return notice(session, channel, `'${args.replace(/^@/, "")}' not found`);
      const hops = resolved.kind === "bot" ? mesh.hopCount(resolved.botId.slice(4)) : 1;
      const relays = Array.from({ length: hops - 1 }, (_, i) => `relay-${100 + i * 7}`);
      const path = ["you", ...relays, args.replace(/^@/, "")].join(" → ");
      return notice(session, channel, `trace: ${path} (${hops} hop${hops > 1 ? "s" : ""})`);
    }

    case "/pay": {
      if (!args) return notice(session, channel, "usage: /pay <cashu token>");
      const token = args.split(/\s+/)[0];
      sendMessage(session, channel, `⚡ ecash token: ${token.slice(0, 24)}…`, "chat");
      return notice(session, channel, "⚡ payment attached to message");
    }

    case "/drop": {
      if (!args) return notice(session, channel, "usage: /drop <message>");
      sendMessage(session, channel, `📍 ${args}`, "chat");
      return notice(session, channel, "📍 note left here — it fades in 24h");
    }

    case "/nick": {
      if (!args) return notice(session, channel, "usage: /nick <name>");
      return renameSession(session, args);
    }

    case "/join": {
      const target = args.replace(/^#/, "").toLowerCase();
      if (!isValidGeohash(target)) return notice(session, channel, "usage: /join <geohash> (e.g. /join dr5rs)");
      const chan = geoChannel(target);
      joinChannel(session, chan);
      nostr.subscribeGeohash(target);
      emitTo(session, "dm-open", { channel: chan, peerId: "system", nickname: `#${target}` });
      emitTo(session, "channel-joined", { channel: chan });
      return;
    }

    default:
      return notice(session, channel, `unknown command: ${cmd} — type /help for commands`);
  }
}

function currentGroup(session: Session, channel: string): string | null {
  if (channel.startsWith("group:") && groups.has(channel) && groups.get(channel)!.members.has(session.socketId)) {
    return channel;
  }
  return null;
}

function renameSession(session: Session, raw: string) {
  const nick = normalizeNickname(raw);
  if (nick.length < 2) return notice(session, session.nickname ? "mesh" : "mesh", "nickname must be 2-16 chars (a-z 0-9 _)");
  if (nickIndex.has(nick)) return notice(session, "mesh", `nickname '${nick}' is taken`);
  const old = session.nickname;
  nickIndex.delete(old.toLowerCase());
  session.nickname = nick;
  nickIndex.set(nick, session.socketId);
  for (const chan of session.channels) {
    broadcast(sysMsg(chan, `${old} is now known as ${nick}`));
  }
  pushPeers("mesh");
}

/** Send a normal (non-command) message from a session into a channel. */
function sendMessage(session: Session, channel: string, content: string, kind: "chat" | "emote" = "chat", clientId?: string) {
  const maxLen = channel.startsWith("geo:") ? 500 : 2000;
  const text = content.slice(0, maxLen);

  if (channel === GLOBAL_CHANNEL) {
    return notice(session, channel, "the global feed is read-only — join a #geohash channel to talk");
  }

  const now = Date.now();
  if (now - session.lastSend < 700) {
    return notice(session, channel, "slow down — mesh rate limit");
  }
  session.lastSend = now;

  if (channel.startsWith("geo:")) {
    const geohash = channel.slice(4);
    if (nostr.connectedCount() === 0) {
      return notice(session, channel, "no geo relays reachable — message not sent");
    }
    const ev = nostr.publishGeohashMessage(session.secretKey, geohash, session.nickname, text, 16);
    if (!ev) return notice(session, channel, "failed to publish — try again");
    const msg: ChatMessage = {
      id: ev.id,
      channel,
      kind,
      senderId: session.socketId,
      nickname: session.nickname,
      content: text,
      ts: Date.now(),
      origin: "nostr",
      deliveryStatus: "sent",
      clientId,
    };
    emitTo(session, "message", { ...msg, deliveryStatus: "sent" });
    for (const s of getSessionsIn(channel)) {
      if (s.socketId === session.socketId) continue;
      if (s.blocked.has(session.nickname.toLowerCase())) continue;
      emitTo(s, "message", msg);
    }
    saveMessage(msg);
    // mirror own message into global feed
    if (channels.has(GLOBAL_CHANNEL)) {
      const g: ChatMessage = {
        ...msg,
        id: `g-${ev.id}`,
        channel: GLOBAL_CHANNEL,
        content: `#${geohash} · ${text}`,
      };
      for (const s of getSessionsIn(GLOBAL_CHANNEL)) {
        if (s.blocked.has(session.nickname.toLowerCase())) continue;
        emitTo(s, "message", g);
      }
      saveMessage(g);
    }
    trim(channel);
    return;
  }

  // mesh / group / dm
  const msg: ChatMessage = {
    id: uid("msg"),
    channel,
    kind,
    senderId: session.socketId,
    nickname: session.nickname,
    content: text,
    ts: Date.now(),
    origin: "web",
    deliveryStatus: "sent",
    clientId,
  };
  broadcast(msg, session.socketId);
  emitTo(session, "message", msg);

  if (channel === MESH_CHANNEL) mesh.reactToMessage(session.nickname, text);
}

// ---------------------------------------------------------------------------
// socket.io handlers

io.on("connection", (socket) => {
  let session: Session | null = null;

  socket.on("hello", (data: { nickname?: string }, cb?: (res: any) => void) => {
    if (session) {
      cb?.({ ok: true, session: sessionInfo(session) });
      return;
    }
    let nick = normalizeNickname(data?.nickname ?? "");
    if (nick.length < 2) nick = `anon${Math.floor(1000 + Math.random() * 9000)}`;
    if (nickIndex.has(nick) || mesh.botByNickname(nick)) {
      const fixed = `${nick}-${Math.floor(10 + Math.random() * 89)}`;
      nick = fixed;
    }
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);
    session = {
      socketId: socket.id,
      nickname: nick,
      secretKey,
      pubkey,
      npub: nostr.npub(pubkey),
      channels: new Set(),
      blocked: new Set(),
      favorites: new Set(),
      lastSend: 0,
    };
    sessions.set(socket.id, session);
    nickIndex.set(nick, socket.id);

    // auto-join the mesh
    joinChannel(session, MESH_CHANNEL);
    const peers = computePeers(MESH_CHANNEL).filter((p) => p.id !== socket.id);
    emitTo(session, "message", sysMsg(MESH_CHANNEL, `*** now talking in #mesh — ${peers.length} peer${peers.length === 1 ? "" : "s"} in range`));
    emitTo(session, "peers", { channel: MESH_CHANNEL, peers });

    cb?.({
      ok: true,
      session: sessionInfo(session),
      relays: nostr.status(),
      geoChannels: geoActivityList(),
      helpText: HELP_TEXT,
    });
    broadcast(sysMsg(MESH_CHANNEL, `— ${nick} joined the mesh`), socket.id);
    pushPeers(MESH_CHANNEL);
    broadcastGeoActivity(true);
  });

  socket.on("join", (data: { channel?: string }, cb?: (res: any) => void) => {
    if (!session || !data?.channel) return cb?.({ ok: false, error: "not ready" });
    const channel = data.channel;

    if (channel.startsWith("dm:") || channel.startsWith("group:")) {
      // participants only
      if (!session.channels.has(channel)) {
        const allowed =
          (channel.startsWith("dm:") && channel.includes(session.socketId)) ||
          (channel.startsWith("group:") && groups.get(channel)?.members.has(session.socketId));
        if (!allowed) return cb?.({ ok: false, error: "not allowed" });
        joinChannel(session, channel);
      }
      return cb?.({ ok: true, history: history(channel), peers: computePeers(channel) });
    }

    if (channel === MESH_CHANNEL) {
      if (!session.channels.has(channel)) joinChannel(session, channel);
      return cb?.({ ok: true, history: history(channel), peers: computePeers(channel).filter((p) => p.id !== socket.id) });
    }

    if (channel === GLOBAL_CHANNEL) {
      if (!session.channels.has(channel)) {
        joinChannel(session, channel);
        nostr.subscribeGlobal();
      }
      return cb?.({ ok: true, history: history(channel), peers: [], readOnly: true });
    }

    if (channel.startsWith("geo:")) {
      const geohash = channel.slice(4);
      if (!isValidGeohash(geohash)) return cb?.({ ok: false, error: "invalid geohash" });
      if (!session.channels.has(channel)) {
        joinChannel(session, channel);
        nostr.subscribeGeohash(geohash);
        const label = PRESET_GEO_CHANNELS.find((p) => p.geohash === geohash)?.label;
        emitTo(
          session,
          "message",
          sysMsg(
            channel,
            `*** now listening in #${geohash}${label ? ` (${label})` : ""} — live nostr channel, messages publish to public relays`
          )
        );
        if (nostr.connectedCount() > 0) nostr.publishPresence(session.secretKey, geohash);
      }
      return cb?.({
        ok: true,
        history: history(channel),
        peers: computePeers(channel).filter((p) => p.id !== socket.id),
      });
    }

    cb?.({ ok: false, error: "unknown channel" });
  });

  socket.on("leave", (data: { channel?: string }) => {
    if (!session || !data?.channel) return;
    const channel = data.channel;
    if (channel === MESH_CHANNEL) return; // mesh is home, can't leave
    leaveChannel(session, channel);
  });

  socket.on("send", (data: { channel?: string; content?: string; clientId?: string }, cb?: (res: any) => void) => {
    if (!session || !data?.channel || typeof data.content !== "string") return cb?.({ ok: false });
    const content = data.content.trim();
    if (!content) return cb?.({ ok: false });
    if (content.startsWith("/")) {
      handleCommand(session, data.channel, content);
      return cb?.({ ok: true, command: true });
    }
    if (!session.channels.has(data.channel)) return cb?.({ ok: false, error: "join the channel first" });
    sendMessage(session, data.channel, content, "chat", data.clientId);
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    if (!session) return;
    const nick = session.nickname;
    for (const chan of [...session.channels]) leaveChannel(session, chan);
    // remove from groups
    for (const [chan, g] of groups) {
      if (g.members.delete(session.socketId)) {
        broadcast(sysMsg(chan, `${nick} left the group`));
        if (g.members.size === 0 && g.bots.size === 0) groups.delete(chan);
      }
    }
    sessions.delete(socket.id);
    nickIndex.delete(nick.toLowerCase());
    broadcast(sysMsg(MESH_CHANNEL, `— ${nick} left the mesh`));
    pushPeers(MESH_CHANNEL);
  });
});

function sessionInfo(s: Session): SessionInfo {
  return { sessionId: s.socketId, nickname: s.nickname, npub: s.npub };
}

// ---------------------------------------------------------------------------
// boot

startupPurge();
nostr.start();
nostr.subscribeGlobal();

httpServer.listen(PORT, () => {
  console.log(`[bitchat-relay] listening on :${PORT}`);
  console.log(`[bitchat-relay] nostr relays: ${nostr.status().map((r) => r.url).join(", ")}`);
  // sanity: the geohash encoder must produce the README's known cell for NYC
  const ny = PRESET_GEO_CHANNELS.find((p) => p.label === "new york");
  if (ny && ny.geohash !== "dr5rs") {
    console.warn(`[bitchat-relay] WARNING: new york geohash = ${ny.geohash}, expected dr5rs`);
  } else if (ny) {
    console.log(`[bitchat-relay] geohash check ok: new york -> ${ny.geohash}`);
  }
});
