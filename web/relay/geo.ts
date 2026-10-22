// Geohash encoding (base32) + preset cities for the channel browser

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Encode lat/lon to a geohash of the given length (standard algorithm). */
export function encodeGeohash(
  lat: number,
  lon: number,
  precision: number
): string {
  let latMin = -90,
    latMax = 90,
    lonMin = -180,
    lonMax = 180;
  let hash = "";
  let bits = 0;
  let bitCount = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        bits = (bits << 1) | 1;
        lonMin = mid;
      } else {
        bits = bits << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        latMin = mid;
      } else {
        bits = bits << 1;
        latMax = mid;
      }
    }
    even = !even;
    bitCount++;
    if (bitCount === 5) {
      hash += BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }
  return hash;
}

/** Rough decode of a geohash cell center (good enough for labels). */
export function decodeGeohash(geohash: string): { lat: number; lon: number } {
  let latMin = -90,
    latMax = 90,
    lonMin = -180,
    lonMax = 180;
  let even = true;
  for (const ch of geohash) {
    const idx = BASE32.indexOf(ch.toLowerCase());
    if (idx === -1) break;
    for (let bit = 4; bit >= 0; bit--) {
      const b = (idx >> bit) & 1;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (b) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (b) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}

/** Major world cities offered as one-tap live channels (city-level, 5 chars). */
export const CITY_PRESETS: { label: string; lat: number; lon: number }[] = [
  { label: "new york", lat: 40.7306, lon: -73.9965 }, // washington sq — lands in the README-famous dr5rs cell
  { label: "london", lat: 51.5074, lon: -0.1278 },
  { label: "paris", lat: 48.8566, lon: 2.3522 },
  { label: "berlin", lat: 52.52, lon: 13.405 },
  { label: "tokyo", lat: 35.6762, lon: 139.6503 },
  { label: "singapore", lat: 1.3521, lon: 103.8198 },
  { label: "sydney", lat: -33.8688, lon: 151.2093 },
  { label: "são paulo", lat: -23.5505, lon: -46.6333 },
  { label: "lagos", lat: 6.5244, lon: 3.3792 },
  { label: "dubai", lat: 25.2048, lon: 55.2708 },
];

export const PRESET_GEO_CHANNELS: { geohash: string; label: string }[] =
  CITY_PRESETS.map((c) => ({
    geohash: encodeGeohash(c.lat, c.lon, 5),
    label: c.label,
  }));

export function isValidGeohash(s: string): boolean {
  return /^[0-9bcdefghjkmnpqrstuvwxyz]{2,9}$/i.test(s);
}
