// Local test relay with the same protocol as worker.js. No dependencies.
// Run: node local-relay.js [port]   then use ws://<this-computer-ip>:<port> as the server in the game.
const http = require('http');
const crypto = require('crypto');
const PORT = +process.argv[2] || 8787;
const MAX_PLAYERS = 4;
const rooms = new Map(); // code -> Set of clients

function frame(text) {
  const p = Buffer.from(text);
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  return Buffer.concat([h, p]);
}
function send(c, text) { if (!c.dead) try { c.sock.write(frame(text)); } catch (e) {} }
function hostOf(set) { let b = null; for (const c of set) if (!c.dead && (!b || c.joined < b.joined)) b = c; return b ? b.id : null; }
function roster(set) { return [...set].filter(c => !c.dead).map(c => ({ id: c.id, name: c.name, lvl: c.lvl })); }

const server = http.createServer((req, res) => { res.end('Kessa Holdout local relay is running.'); });
server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{3,12})$/);
  const key = req.headers['sec-websocket-key'];
  if (!m || !key) { sock.destroy(); return; }
  const code = m[1].toUpperCase();
  const set = rooms.get(code) || new Set(); rooms.set(code, set);
  if (roster(set).length >= MAX_PLAYERS) { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const c = { sock, id: crypto.randomUUID().slice(0, 8), name: (url.searchParams.get('name') || 'Operator').slice(0, 16),
    lvl: +url.searchParams.get('lvl') || 1, joined: Date.now() + Math.random(), buf: Buffer.alloc(0), dead: false };
  set.add(c);
  send(c, JSON.stringify({ t: 'welcome', id: c.id, host: hostOf(set), players: roster(set) }));
  for (const o of set) if (o !== c) send(o, JSON.stringify({ t: 'join', id: c.id, name: c.name, lvl: c.lvl, host: hostOf(set) }));
  const drop = () => {
    if (c.dead) return; c.dead = true; set.delete(c);
    for (const o of set) send(o, JSON.stringify({ t: 'leave', id: c.id, host: hostOf(set) }));
    if (!set.size) rooms.delete(code);
    try { sock.destroy(); } catch (e) {}
  };
  sock.on('close', drop); sock.on('error', drop);
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    while (c.buf.length >= 2) {
      const op = c.buf[0] & 15, masked = c.buf[1] & 128; let len = c.buf[1] & 127, off = 2;
      if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
      const mk = masked ? c.buf.slice(off, off + 4) : null; if (masked) off += 4;
      if (c.buf.length < off + len) return;
      const p = Buffer.from(c.buf.slice(off, off + len)); c.buf = c.buf.slice(off + len);
      if (mk) for (let i = 0; i < p.length; i++) p[i] ^= mk[i & 3];
      if (op === 8) { drop(); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, p.length]), p])); continue; }
      if (op !== 1) continue;
      let msg; try { msg = JSON.parse(p.toString()); } catch (e) { continue; }
      msg.from = c.id;
      if (msg.t === 'ping') { send(c, JSON.stringify({ t: 'pong', at: msg.at })); continue; }
      const text = JSON.stringify(msg);
      for (const o of set) if (o !== c && (!msg.to || o.id === msg.to)) send(o, text);
    }
  });
});
server.listen(PORT, () => console.log(`Kessa Holdout local relay on ws://localhost:${PORT}`));
