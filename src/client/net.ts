// How the screen talks to a room: over a WebSocket to the online room, or straight to a room
// that runs in this browser (solo against bots).
import { ClientMsg, RoomCore, View, newRoom } from "../shared/room";
import { saved } from "./store";

export interface Conn {
  send(msg: ClientMsg): void;
  close(): void;
}
export interface Handlers {
  view(v: View): void;
  /** fatal: the room can't be used (wrong code, full, closed). */
  error(code: string, fatal: boolean): void;
  status(online: boolean): void;
}

export const SERVER: string = import.meta.env.VITE_SERVER || "ws://localhost:8787";

export function randomCode(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export function online(code: string, create: boolean, h: Handlers): Conn {
  let ws: WebSocket | null = null;
  let closed = false, tries = 0, everOpen = false;
  let ping = 0, retry = 0;

  const open = () => {
    const q = new URLSearchParams({ pid: saved.pid, name: saved.name || "Player" });
    if (create && !everOpen) q.set("create", "1");
    ws = new WebSocket(`${SERVER}/ws/${code}?${q}`);
    ws.onopen = () => {
      tries = 0; everOpen = true;
      h.status(true);
      clearInterval(ping);
      ping = window.setInterval(() => { if (ws?.readyState === 1) ws.send("ping"); }, 20000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      let m: { t: string; v?: View; e?: string; fatal?: boolean };
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "view" && m.v) h.view(m.v);
      if (m.t === "err") {
        if (m.fatal) closed = true;
        h.error(m.e || "bad", !!m.fatal);
      }
    };
    ws.onclose = (e) => {
      clearInterval(ping);
      if (closed) return;
      if (e.code === 4001) { closed = true; h.error("replaced", true); return; }
      if (e.code === 1000) { closed = true; h.error("closed", true); return; }
      h.status(false);
      if (++tries > 8) { closed = true; h.error(everOpen ? "lost" : "offline", true); return; }
      retry = window.setTimeout(open, Math.min(4000, 400 * tries));
    };
  };
  open();

  return {
    send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); },
    close() {
      closed = true;
      clearInterval(ping); clearTimeout(retry);
      try { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "leave" })); ws?.close(); } catch { /* gone already */ }
    },
  };
}

/** A room in this browser: you and some bots. */
export function solo(bots: number, h: Handlers): Conn {
  const core = new RoomCore(newRoom("SOLO", Date.now()));
  const me = saved.pid;
  let timer = 0, closed = false;
  const sync = () => {
    if (closed) return;
    const now = Date.now();
    h.view(core.view(me, core.flush(), now));
    clearTimeout(timer);
    const wake = core.wake(now);
    if (wake) timer = window.setTimeout(() => { core.tick(Date.now()); sync(); }, wake - now);
  };
  core.join(me, saved.name || "Player", Date.now());
  for (let i = 0; i < bots; i++) core.handle(me, { t: "bot" }, Date.now());
  core.handle(me, { t: "start" }, Date.now());
  setTimeout(sync, 0);
  return {
    send(msg) {
      if (closed) return;
      const err = core.handle(me, msg, Date.now());
      if (err) h.error(err, false);
      else sync();
    },
    close() { closed = true; clearTimeout(timer); },
  };
}
