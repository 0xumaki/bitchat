// Peer nickname colors — adapted from bitchat's Color+Peer.swift:
// DJB2 hash of the peer seed -> HSL with orange-hue avoidance.
// Tuned for the AETHER dark-glass palette: softer saturation and a
// higher lightness floor so identity colors read as premium accents
// on the #080808 surface instead of neon terminal hues.

// DJB2 as used by String+DJB2.swift (UInt32 wraparound)
function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33 + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

const HUE_AVOIDANCE_DELTA = 30 / 360 / 2 + 0.02; // stay clear of the alert-orange hue
const HUE_OFFSET = 0.09;

/** Deterministic color for a peer nickname (AETHER dark scheme). */
export function peerColor(seed: string): string {
  const h = djb2(seed);
  let hue = (h % 1000) / 1000;
  const orange = 30 / 360;
  if (Math.abs(hue - orange) < HUE_AVOIDANCE_DELTA) {
    hue = (hue + HUE_OFFSET) % 1;
  }
  const sRand = ((h >>> 17) & 0x3ff) / 1023;
  const bRand = ((h >>> 27) & 0x3ff) / 1023;
  const saturation = Math.min(1, Math.max(0.45, 0.58 + (sRand - 0.5) * 0.22));
  const lightness = Math.min(1, Math.max(0.62, 0.74 + (bRand - 0.5) * 0.16));
  return `hsl(${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`;
}

/** Muted variant for idle/secondary text of that peer. */
export function peerColorDim(seed: string): string {
  const c = peerColor(seed);
  return c.replace(/(\d+)%\)$/, "48%)");
}
