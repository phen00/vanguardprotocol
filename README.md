# Vanguard Protocol

A low-res sci-fi co-op horde shooter that runs in the browser. First map: **Holdout: Kessa**.

## Play

Open https://vanguard-protocol.retrohome.workers.dev in Chrome or Edge, or open `site/index.html` directly.

| Key | Action |
| --- | --- |
| WASD | Move (Shift to sprint, Space to jump) |
| Mouse | Look, left click to fire, right click to aim |
| R / Q / E | Reload / Shockwave / Use the medical station |

Touch controls appear automatically on phones and tablets.

## Multiplayer

Co-op for up to 4 players. One player picks **Multiplayer → Create room** and shares the code; the others join with it; the room creator starts the game.

Rooms run on a Cloudflare Worker with Durable Objects (`server/worker.js`), deployed at `kessa-relay.retrohome.workers.dev`. The host's game runs the enemies and the relay passes messages between players.

## Repository layout

| Path | What it is |
| --- | --- |
| `site/` | The playable build (index.html, three.js, fonts) served by the Worker |
| `src/game.html` | Game source |
| `tools/build.py` | Rebuilds `site/index.html` from `src/game.html` |
| `server/` | Relay Worker (`worker.js`, `wrangler.toml`) and an optional LAN relay (`local-relay.js`) |
| `wrangler.toml` | Config for the `vanguard-protocol` Worker that serves `site/` |
| `licenses/` | three.js (MIT) and font (OFL) licences |

## Deployment

- **Game:** the repo is connected to the `vanguard-protocol` Worker through Cloudflare Workers Builds. Every push to `main` runs `npx wrangler deploy`, which uploads `site/` as static assets.
- **Rooms:** the relay runs on the separate `kessa-relay` Worker. It is not redeployed by pushes; to update it, run `npx wrangler deploy` inside `server/`.
