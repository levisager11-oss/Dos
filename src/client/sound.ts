// Small beeps made in the browser, no sound files.
import { saved } from "./store";

let ctx: AudioContext | null = null;

function tone(freq: number, at: number, len: number, type: OscillatorType = "triangle", vol = 0.08) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + at;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}

const SOUNDS: Record<string, () => void> = {
  play: () => tone(520, 0, 0.09),
  draw: () => tone(260, 0, 0.08, "sine"),
  turn: () => { tone(660, 0, 0.1); tone(880, 0.09, 0.14); },
  hit: () => { tone(180, 0, 0.18, "sawtooth", 0.06); tone(140, 0.1, 0.2, "sawtooth", 0.06); },
  block: () => { tone(900, 0, 0.08, "square", 0.04); tone(1200, 0.06, 0.12, "square", 0.04); },
  power: () => { tone(440, 0, 0.08); tone(660, 0.06, 0.08); tone(990, 0.12, 0.12); },
  chaos: () => { tone(330, 0, 0.1, "square", 0.04); tone(495, 0.08, 0.1, "square", 0.04); tone(392, 0.16, 0.14, "square", 0.04); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.14, 0.25, "sine")),
};

export function sound(name: keyof typeof SOUNDS | string) {
  if (saved.mute) return;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    SOUNDS[name]?.();
  } catch { /* no sound on this device */ }
}
