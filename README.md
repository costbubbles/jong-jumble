# Mahjong Rows

A riichi mahjong sliding-tile puzzle for the browser. Rotate rows and columns until every row is a
winning hand with at least one yaku.

The full design spec is in [CLAUDE.md](CLAUDE.md).

## Run locally

Requires Node.js 20+.

```sh
npm test          # run the logic tests
npm start         # game + multiplayer server on http://localhost:8080 (from phase 6)
npx serve .       # single player only, any static file server works
```

ES modules don't load from `file://`, so open the game through a server.

## Configuration

All tunable defaults (the scoring formula, difficulty presets, generation weights, UI and multiplayer
settings) are in [`js/config.js`](js/config.js).

## Project layout

```
index.html, css/        page + styles
sprites/                tile art (32x32 PNG)
js/config.js            all tunable settings + scoring formula
js/core/                pure game logic, shared by browser, server and tests
js/ui/                  rendering + HUD
js/net/                 multiplayer client
server/                 Node server (static files + WebSocket rooms)
tests/                  node --test
```

## Deploy

- **Single player only:** the repo root is a static site. Push it to GitHub Pages, Netlify,
  Cloudflare Pages, etc. There's no build step.
- **With multiplayer:** deploy as one Node web service (Render, Railway, Fly.io…) with the start
  command `npm start`. The server serves the static files as well as the WebSocket rooms and reads the
  `PORT` environment variable.
