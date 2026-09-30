# Jong Jumble

A riichi mahjong sliding-tile puzzle for the browser. Rotate rows and columns until every row is a
winning hand with at least one yaku.

The full design spec is in [CLAUDE.md](CLAUDE.md).

## Run locally

Requires Node.js 20+.

```sh
npm install       # installs the WebSocket library used by 1v1
npm test          # logic + room tests
npm start         # game + 1v1 server on http://localhost:8080
```

To try 1v1 on one machine, open http://localhost:8080 in two browser windows: create a room in one, join
with the code in the other. Other devices on your network can join via `http://<your-PC-IP>:8080`.

## Configuration

All tunable defaults (the scoring formula, difficulty presets, generation weights, UI, home screen and 1v1
settings) are in [`js/config.js`](js/config.js).

## Project layout

```
index.html, css/        page + styles
sprites/                tile art (32x32 PNG)
assets/home/            title screen art (title, buttons, logo)
assets/fonts/           Silkscreen pixel font (OFL)
js/config.js            all tunable settings + scoring formula
js/core/                pure game logic, shared by browser, server and tests
js/ui/                  board view, HUD, title screen
js/net/                 1v1 client + shared protocol
server/                 Node server: static files + WebSocket rooms (rooms.js)
tests/                  node --test
render.yaml             one-click deploy config for Render
```

## Deploy

The whole game (single player and 1v1) runs as **one Node web service**: `npm install`, then `npm start`.
The server reads the `PORT` environment variable, serves the static files, and hosts the 1v1 rooms on
WebSocket path `/ws`. `/healthz` returns `ok` for health checks.

- **Render (free):** push to GitHub, then on render.com choose *New → Blueprint* and pick the repo;
  `render.yaml` sets everything up. Free instances sleep when idle, so the first visit can take ~30 s.
- **Railway / Fly.io / any VPS:** same thing: build `npm install`, start `npm start`, WebSockets enabled.
- **Static hosting only** (GitHub Pages, Netlify): single player works, 1v1 doesn't (it needs the server).
