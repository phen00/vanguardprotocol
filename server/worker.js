// Kessa Holdout relay: one Durable Object per room code.
// Clients connect to wss://<your-worker>/room/<CODE>?name=<callsign>.
// The first player in a room is the host; if the host leaves, the next oldest player takes over.
// The server only relays messages; the host's game runs the enemies.

const MAX_PLAYERS = 4;

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const live = this.players();
    if (live.length >= MAX_PLAYERS) return new Response('Room is full', { status: 403 });

    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || 'Operator').replace(/[^\w .\-]/g, '').slice(0, 16) || 'Operator';
    const lvl = Math.max(1, Math.min(100, parseInt(url.searchParams.get('lvl') || '1', 10) || 1));

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const me = { id: crypto.randomUUID().slice(0, 8), name, lvl, joined: Date.now() };
    server.serializeAttachment(me);

    server.send(JSON.stringify({ t: 'welcome', id: me.id, host: this.hostId(), players: this.roster() }));
    this.broadcast(JSON.stringify({ t: 'join', id: me.id, name, lvl, host: this.hostId() }), server);
    return new Response(null, { status: 101, webSocket: client });
  }

  players() {
    return this.ctx.getWebSockets().map(ws => ({ ws, a: ws.deserializeAttachment() })).filter(p => p.a);
  }
  roster() {
    return this.players().map(p => ({ id: p.a.id, name: p.a.name, lvl: p.a.lvl }));
  }
  hostId() {
    let best = null;
    for (const p of this.players()) if (!best || p.a.joined < best.joined) best = p.a;
    return best ? best.id : null;
  }
  broadcast(text, except) {
    for (const p of this.players()) if (p.ws !== except) { try { p.ws.send(text); } catch (e) {} }
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 65536) return;
    const a = ws.deserializeAttachment();
    if (!a) return;
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    m.from = a.id;
    if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', at: m.at })); return; }
    const text = JSON.stringify(m);
    if (m.to) {
      for (const p of this.players()) if (p.a.id === m.to) { try { p.ws.send(text); } catch (e) {} }
    } else {
      this.broadcast(text, ws);
    }
  }

  async webSocketClose(ws, code) { this.drop(ws, code); }
  async webSocketError(ws) { this.drop(ws, 1011); }

  drop(ws, code) {
    const a = ws.deserializeAttachment();
    ws.serializeAttachment(null);
    try { ws.close(code === 1005 ? 1000 : (code || 1000), 'bye'); } catch (e) {}
    if (a) this.broadcast(JSON.stringify({ t: 'leave', id: a.id, host: this.hostId() }), ws);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{3,12})$/);
    if (!m) {
      return new Response('Kessa Holdout relay is running. Connect to /room/<CODE>.', { headers: { 'content-type': 'text/plain' } });
    }
    const id = env.ROOMS.idFromName(m[1].toUpperCase());
    return env.ROOMS.get(id).fetch(request);
  }
};
