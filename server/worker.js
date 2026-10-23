// Vanguard Protocol server: co-op relay rooms plus player accounts.
// Rooms: one Durable Object per room code.
// Accounts: one Durable Object instance (named __ACCOUNTS__) stores users, password hashes
// (PBKDF2-SHA256, random salt) and saved profiles; clients sign in and get a bearer token.
// Clients connect to wss://<your-worker>/room/<CODE>?name=<callsign>.
// The first player in a room is the host; if the host leaves, the next oldest player takes over.
// The server only relays messages; the host's game runs the enemies.

const MAX_PLAYERS = 4;

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (new URL(request.url).pathname.startsWith('/api/')) return this.api(request);
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

  // ---- accounts ----
  async api(request) {
    const url = new URL(request.url), path = url.pathname, st = this.ctx.storage;
    const body = request.method === 'POST' || request.method === 'PUT' ? await request.json().catch(() => ({})) : {};
    if (path === '/api/register' || path === '/api/login') {
      const name = String(body.user || '').trim(), pass = String(body.pass || '');
      if (!/^[A-Za-z0-9_.\-]{3,16}$/.test(name)) return json({ error: 'Usernames are 3-16 letters, numbers, dots, dashes or underscores.' }, 400);
      if (pass.length < 6 || pass.length > 128) return json({ error: 'Passwords need at least 6 characters.' }, 400);
      const key = 'u:' + name.toLowerCase();
      let u = await st.get(key);
      if (path === '/api/register') {
        if (u) return json({ error: 'That username is taken.' }, 409);
        const salt = crypto.getRandomValues(new Uint8Array(16));
        u = { name, salt: hex(salt), hash: await pbkdf2(pass, salt), created: Date.now(), profile: body.profile && JSON.stringify(body.profile).length < 16000 ? body.profile : null };
        await st.put(key, u);
      } else {
        const lockKey = 'f:' + name.toLowerCase(), lock = (await st.get(lockKey)) || { n: 0, t: 0 };
        if (lock.n >= 8 && Date.now() - lock.t < 15 * 60 * 1000) return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);
        if (!u || (await pbkdf2(pass, unhex(u.salt))) !== u.hash) {
          await st.put(lockKey, { n: (Date.now() - lock.t > 15 * 60 * 1000 ? 0 : lock.n) + 1, t: Date.now() });
          return json({ error: 'Wrong username or password.' }, 401);
        }
        await st.delete(lockKey);
      }
      const token = hex(crypto.getRandomValues(new Uint8Array(24)));
      await st.put('t:' + token, { u: key, exp: Date.now() + 60 * 24 * 3600 * 1000 });
      return json({ token, name: u.name, profile: u.profile || null });
    }
    const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const t = auth && /^[0-9a-f]{48}$/.test(auth) ? await st.get('t:' + auth) : null;
    if (!t || t.exp < Date.now()) return json({ error: 'Signed out. Please sign in again.' }, 401);
    const u = await st.get(t.u);
    if (!u) return json({ error: 'Account not found.' }, 404);
    if (path === '/api/profile' && request.method === 'GET') return json({ name: u.name, profile: u.profile || null });
    if (path === '/api/profile' && request.method === 'PUT') {
      const prof = body.profile;
      if (!prof || typeof prof !== 'object' || JSON.stringify(prof).length > 16000) return json({ error: 'Profile too large.' }, 400);
      u.profile = prof; u.saved = Date.now(); await st.put(t.u, u);
      return json({ ok: true, saved: u.saved });
    }
    if (path === '/api/logout' && request.method === 'POST') { await st.delete('t:' + auth); return json({ ok: true }); }
    return json({ error: 'Not found' }, 404);
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

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400' };
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } }); }
const hex = a => [...a].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
async function pbkdf2(pass, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256)));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname.startsWith('/api/')) return env.ROOMS.get(env.ROOMS.idFromName('__ACCOUNTS__')).fetch(request);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{3,12})$/);
    if (!m) {
      return new Response('Vanguard Protocol server is running. Rooms at /room/<CODE>, accounts at /api/.', { headers: { 'content-type': 'text/plain' } });
    }
    const id = env.ROOMS.idFromName(m[1].toUpperCase());
    return env.ROOMS.get(id).fetch(request);
  }
};
