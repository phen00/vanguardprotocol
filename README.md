# Vanguard Protocol

A low-res sci-fi co-op horde shooter that runs in the browser. First map: **Holdout: Kessa**.

## Play

Open `index.html` in Chrome or Edge, or visit the Cloudflare Pages link once it is set up.

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
| `index.html`, `three.min.js`, `fonts/`, `fonts.css` | The playable build that Pages serves |
| `src/game.html` | Game source |
| `tools/build.py` | Rebuilds `index.html` from `src/game.html` |
| `server/` | Relay Worker (`worker.js`, `wrangler.toml`) and an optional LAN relay (`local-relay.js`) |
| `licenses/` | three.js (MIT) and font (OFL) licences |

## Hosting on Cloudflare Pages

Workers & Pages → Create → Pages → Connect to Git → pick this repo. Leave the build command empty and the output directory as `/`. Every push to `main` redeploys the site.
