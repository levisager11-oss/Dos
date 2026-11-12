// What the game remembers on this device. Inside Toki, localStorage follows the player to
// their other devices by itself.
export interface Saved {
  pid: string;
  name: string;
  lang: "en" | "de" | "";
  mute: boolean;
  bots: number;
  games: number;
  wins: number;
  best: number;
  seenHelp: boolean;
}

const KEY = "surge:v1";

function newPid(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 28);
}

function load(): Saved {
  const base: Saved = { pid: "", name: "", lang: "", mute: false, bots: 3, games: 0, wins: 0, best: 0, seenHelp: false };
  try { Object.assign(base, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* fresh start */ }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(base.pid)) base.pid = newPid();
  return base;
}

export const saved: Saved = load();

export function save(patch: Partial<Saved> = {}) {
  Object.assign(saved, patch);
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ }
}
save();
