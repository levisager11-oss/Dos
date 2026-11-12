// The online rooms of Dos on Cloudflare: one Durable Object per room code. Players connect
// with a WebSocket; the room keeps its state in storage, so it survives being put to sleep.
import { DurableObject } from "cloudflare:workers";
import { ClientMsg, RoomCore, RoomState, newRoom } from "../src/shared/room";

interface Env { ROOMS: DurableObjectNamespace<Room> }

const CODE = /^[A-Z0-9]{4,8}$/;
const cors = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]+)$/);
    if (!m) return new Response("Dos rooms are running.", { headers: cors });
    const code = m[1].toUpperCase();
    if (!CODE.test(code)) return new Response("bad code", { status: 400, headers: cors });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426, headers: cors });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
};

export class Room extends DurableObject<Env> {
  private core: RoomCore | null = null;
  private loaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private async load() {
    if (this.loaded) return;
    const s = await this.ctx.storage.get<RoomState>("s");
    this.core = s ? new RoomCore(s) : null;
    this.loaded = true;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.pathname.split("/").pop()!.toUpperCase();
    const pid = url.searchParams.get("pid") ?? "";
    const name = url.searchParams.get("name") ?? "";
    const create = url.searchParams.get("create") === "1";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const refuse = (e: string) => {
      server.accept();
      server.send(JSON.stringify({ t: "err", e, fatal: true }));
      server.close(4000, e);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(pid)) return refuse("bad");
    await this.load();
    const now = Date.now();
    if (!this.core) {
      if (!create) return refuse("no_room");
      this.core = new RoomCore(newRoom(code, now));
    }
    const err = this.core.join(pid, name, now);
    if (err) return refuse(err);
    // One connection per player: a new tab takes over.
    for (const old of this.ctx.getWebSockets(pid)) old.close(4001, "replaced");
    this.ctx.acceptWebSocket(server, [pid]);
    await this.sync(now);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > 2000) return;
    await this.load();
    if (!this.core) return;
    const [pid] = this.ctx.getTags(ws);
    let msg: ClientMsg;
    try { msg = JSON.parse(data); } catch { return; }
    const now = Date.now();
    const err = this.core.handle(pid, msg, now);
    if (err) { ws.send(JSON.stringify({ t: "err", e: err })); return; }
    if (msg.t === "leave") ws.close(1000, "left");
    await this.sync(now);
  }

  async webSocketClose(ws: WebSocket) { await this.gone(ws); }
  async webSocketError(ws: WebSocket) { await this.gone(ws); }

  private async gone(ws: WebSocket) {
    await this.load();
    if (!this.core) return;
    const [pid] = this.ctx.getTags(ws);
    const still = this.ctx.getWebSockets(pid).some((w) => w !== ws && w.readyState === WebSocket.OPEN);
    const now = Date.now();
    if (!still) this.core.setOn(pid, false, now);
    await this.sync(now);
  }

  async alarm() {
    await this.load();
    if (!this.core) return;
    const now = Date.now();
    this.core.tick(now);
    await this.sync(now);
  }

  /** Sends everyone their view, stores the room and sets the next wake-up. */
  private async sync(now: number) {
    const core = this.core!;
    if (core.dead(now)) {
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, "closed");
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.core = null;
      return;
    }
    const ev = core.flush();
    for (const ws of this.ctx.getWebSockets()) {
      const [pid] = this.ctx.getTags(ws);
      try { ws.send(JSON.stringify({ t: "view", v: core.view(pid, ev, now) })); } catch { /* closing */ }
    }
    await this.ctx.storage.put("s", core.s);
    const wake = core.wake(now);
    if (wake) await this.ctx.storage.setAlarm(wake);
    else await this.ctx.storage.deleteAlarm();
  }
}
