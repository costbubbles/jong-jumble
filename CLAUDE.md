# Jong Jumble — riichi hand sliding puzzle (HTML5)

A browser puzzle game. The board is a playfield of mahjong tiles with **R rows × 13 columns**, plus a fixed
**winning-tile column** on the right. Arrow controls on the edges rotate rows and columns of the playfield
(wrapping around). The puzzle is solved when **every row is a valid
riichi winning hand with at least one yaku**.

This file is the design spec and the build plan. Keep it up to date when decisions change.

---

## 1. Decisions (confirmed with the user)

| Topic | Decision |
|---|---|
| Columns | **13-column playfield + 1 fixed winning tile per row** (red outline, its own "Win" column). The winning tile never moves: row and column shifts only touch the playfield. It completes the row's one incomplete group, wherever that group is (§4.4). |
| Hand validity | Winning shape **in a valid left-to-right order** (§4.4) **and at least 1 yaku**. A **Tile order** setting (solo setup, 1v1 host): Strict / Reverse OK / Any order (§4.5). |
| Yaku context | Fully closed rows count as **riichi** (so they always have a yaku). Rows with an open set need a real yaku. Each row has its own **seat wind**; the **round wind** is shared by the puzzle. The win is always treated as **tsumo**. |
| Open sets | **Pon + chii only** (3-tile chains, no kans). Chains can never be split. Drawn "locked": greyer and smaller, with one random tile turned sideways (clockwise) (`cell.sideways`, chosen by the seeded generator). |
| Row wrap | A chain wraps **as one unit** (see §3.2). |
| Chain clash on vertical move | **Blocked**: the arrow is disabled (see §3.3). |
| Tile limits | **Per row, at generation time only**: at most 4 copies of a tile (red 5 counts as 5) and at most one red five per suit. The grid as a whole may exceed a real set. Rows mix during play, so the validity checks don't enforce these limits. |
| Scramble | Start from solved rows and apply **N random legal moves**. Always solvable. |
| Modes | **Seed input** (empty = random) + difficulty **Easy / Medium / Hard = 2 / 3 / 4 rows**, and **live head-to-head multiplayer**. |
| QoL | Move counter, timer, undo, per-row validity glow, **per-row shanten counter** (+ "no yaku" flag), **Restart** and **New/Reset** buttons, colored group boxes, hover + WASD/arrow-key controls (§6). |
| Config | **Every tunable default lives in `js/config.js`**: the scoring formula, difficulty presets, generation weights, UI, and multiplayer defaults. Don't hard-code tunables elsewhere. |
| Scoring | One formula for SP and MP, defined in `js/config.js` → `SCORING` (§6.1). |
| Multiplayer match | **Best of N rounds.** All N rounds are always played; scores stay hidden until the end. Each round has a host-set time limit; an unsolved round scores 0. The host toggles hints and picks the control mode (shift or drag & drop) for both players. |
| Art | User-supplied **32×32 pixel-art PNGs** in `sprites/` (§2). There is **no tile back**. |
| Stack | **Vanilla JS, ES modules, no build step.** DOM/CSS rendering. Pure logic modules are shared with the server. |
| Multiplayer backend | **Small Node.js + `ws` WebSocket server**, which also serves the static files. |

---

## 2. Tile model

Tile IDs are strings in standard notation:

- Manzu `1m`–`9m`, pinzu `1p`–`9p`, souzu `1s`–`9s`
- Red fives: `0m`, `0p`, `0s` (treated as `5x` for all logic, cosmetic otherwise)
- Honors: `1z`=East `2z`=South `3z`=West `4z`=North `5z`=Haku (white) `6z`=Hatsu (green) `7z`=Chun (red)

Helpers in `js/core/tiles.js`: `normalize(id)` (0→5), `suit(id)`, `num(id)`, `isHonor`, `isTerminal`,
`isSimple`, `toIndex34(id)` (0..33 for counting arrays), `sortKey`.

**Art mapping:** `TILE_IMAGES` in `js/core/tiles.js` maps each tile ID to a file in `sprites/`.
⚠ The sprite filenames use a **different suit letter** from the internal notation:

| Internal | Sprite file | Suit |
|---|---|---|
| `1m`–`9m` | `1m.png`–`9m.png` | man |
| `1p`–`9p` | `1s.png`–`9s.png` | **pin (circles) = `s` in the files** |
| `1s`–`9s` | `1b.png`–`9b.png` | **sou (bamboo) = `b` in the files** |
| `0m` / `0p` / `0s` | `5rm.png` / `5rs.png` / `5rb.png` | red fives |
| `1z`–`4z` | `east.png` `south.png` `west.png` `north.png` | winds |
| `5z` `6z` `7z` | `white.png` `Green.png` `Red.png` | dragons (**capitalization is exact**; servers are case-sensitive) |

Only `TILE_IMAGES` knows the file names; nothing else may build sprite paths.
Render the sprites scaled by an integer factor with `image-rendering: pixelated`.
If an image fails to load, fall back to a placeholder (colored rectangle + text).

---

## 3. Board model and moves

```
Board {                          // plain JSON, never mutated
  cols: 13,                      // playfield only
  cells: Cell[R][13],            // Cell = { tile, chain: string|null, sideways?: true }
  winTiles: TileId[R],           // each row's fixed winning tile (never moved)
  roundWind: '1z'..'4z',
  seatWinds: TileId[R]           // belongs to the row position: row i -> East, South, West, North
}
```
The chain type (pon/chi) is derived from its tiles (`meldType`). For tests and fixed levels, build
boards from 14-tile notation: `createBoard({ rows: ['406s 345p 99p 56m [222z] 4m'] })`. Brackets mark a chain,
and the **last tile is the row's winning tile**.

A chain always occupies **3 horizontally adjacent cells in one row** (never wrapped across the edge).
Whatever row a chain sits in, it counts as an open set **of that row**. Chains can move between
rows through vertical moves.

All moves are **pure functions** `(board, move) -> board | null` (null = illegal) in `js/core/board.js`.
Every legal move has a legal exact inverse, so a board scrambled by random moves is always solvable
by reversing them.

### 3.1 Move types
- `{ type: 'row', row, dir: 'left'|'right' }`
- `{ type: 'col', col, dir: 'up'|'down' }`
- `{ type: 'drop', from: { row, start, len }, to: { row, col } }` (drag & drop mode only; never used by the
  scramble). Same row: reorder (segment lifted out, gap closes, re-inserted starting at `to.col`). Other row:
  swap with the `len` tiles at `to.col`. Illegal if any chain ends up split. `expandSelection` grows a selection
  to cover whole chains. `inverseMove` works for drops too.

### 3.2 Row rotation (wrap chains as a unit)
Treat the row as a circular list of **units**: each loose tile is a unit, and each chain is one
3-wide unit. A left shift moves the first unit to the end; a right shift moves the last unit to the front.
- If the unit that wraps is a loose tile, everything visibly shifts by 1.
- If it is a chain, the whole row shifts by 3, so the chain never splits across the edge.

> Note: the original option text said "the other tiles still shift by 1". That is impossible when a chain
> wraps, because the 3 cells have to come from somewhere. Unit rotation is the consistent, reversible
> version of that idea.

### 3.3 Column rotation (chains push their columns; misaligned clash = blocked)
Pressing a vertical arrow on column `c`:
1. `S = {c}` ∪ the columns of every chain (in any row) that covers `c`.
2. If the chains covering `c` do not all span exactly the same 3 columns → **blocked**.
3. If any chain in any row intersects `S` without being fully inside `S` → **blocked**.
4. Otherwise rotate **every column in `S`** by 1 (up/down, wrapping). Chains stay intact and move
   to the adjacent row.

A column that no chain touches always moves alone. The UI greys out blocked arrows (`canMove()`).
Because the chains are the same before and after the move, the inverse is legal whenever the move was.

---

## 4. Hand evaluation (`js/core/hand.js`, `js/core/yaku.js`)

Per row: `openMelds` = chains in the row (k of them), `closed` = the other 13 − 3k playfield tiles + the winning tile.
§4.1–4.3 treat the row as a **multiset** (used for shanten and hints). The actual win condition also
requires **order** (§4.4).

### 4.1 Shape
- **Standard:** `closed` splits into (4 − k) sets + 1 pair. Enumerate **all** decompositions, because
  yaku scoring needs them.
- **Chiitoitsu:** k = 0, 7 distinct pairs.
- **Kokushi:** k = 0, all 13 terminals/honors + one duplicate.

### 4.2 Yaku (row is valid if ≥1 applies under any decomposition)
- **Closed (k = 0):** riichi always applies, so the shape alone is enough. (Still compute the other yaku
  for display/fun.)
- **Open (k ≥ 1):** check the open-legal yaku. Tsumo is assumed. There are no kans:
  - Yakuhai: triplet of Haku / Hatsu / Chun / seat wind / round wind (a double wind counts twice)
  - Tanyao (kuitan allowed)
  - Toitoi, Sanankou (closed triplets only; tsumo, so no ron ambiguity)
  - Honitsu, Chinitsu
  - Sanshoku doujun, Ittsu (Ikkitsuukan), Chanta, Junchan
  - Sanshoku doukou, Shousangen, Honroutou
  - Yakuman: Daisangen, Shousuushii, Daisuushii, Tsuuiisou, Chinroutou, Ryuuiisou
- Closed-only: Pinfu (all sequences, non-value pair, ryanmen wait), Iipeikou, Ryanpeikou, Suuankou,
  Chiitoitsu, Kokushi.

### 4.2b Hand value (`js/core/points.js`)
Every win is a **tsumo**. Seat wind East = dealer. Red fives are the only dora (aka dora, +1 han each).
- Han per yaku (closed/open values), yakuman = 13 each (multiple yakuman stack).
- Fu: 20 + 2 tsumo (pinfu tsumo = 20 flat); pon 2/4 (open/closed), doubled for terminals/honors; pair of
  dragon/seat/round +2 each; kanchan/penchan/tanki wait +2; round up to 10. Chiitoitsu = 25.
- Points: basic = fu × 2^(han+2), capped at mangan; limits mangan/haneman/baiman/sanbaiman/kazoe.
  Tsumo total: dealer 3 × roundup100(2b); non-dealer roundup100(2b) + 2 × roundup100(b).
- The best-scoring valid parse wins. `evaluateRow` returns
  `{ status, solved, shanten, yaku, yakuHan: [{name, han}], han, fu, points, limit, groups }`.

### 4.3 Shanten
Standard shanten per row. With k open melds, compute it on the closed tiles with 4 − k sets needed.
Take the minimum over regular / chiitoi / kokushi (the last two only when k = 0). **Order is ignored.**

### 4.4 Ordered win rule (`evaluateOrdered` in `js/core/yaku.js`)
- The **winning tile** is the row's fixed tile in the Win column (`board.winTiles[r]`).
- The playfield's loose tiles are read left to right. **Chains split them into separate runs**, so a group
  can't span across a chain. Each run must split into contiguous groups:
  - **Sequence:** ascending only (4-5-6 ✓, 6-5-4 ✗, 5-4-6 ✗). A red 5 counts as 5.
  - **Triplet:** 3 identical tiles in any order (red 5 = 5).
  - **Pair:** 2 identical tiles, side by side.
- There is **exactly one wait group**, which the winning tile completes (the wait's own tiles must still be in
  order, but they don't have to touch the winning tile): a single tile (tanki → pair), a pair
  (shanpon → triplet), or two ascending tiles (ryanmen/penchan/kanchan → sequence).
- Totals: 4 sets (chains included) + 1 pair. **Chiitoitsu:** 7 distinct adjacent pairs (one of them is the
  tanki). **Kokushi:** any order.
- Row status (`evaluateRow`):
  - `solved`: ordered win with a yaku (the row glows)
  - `noyaku`: the tiles win but no yaku is possible
  - `reorder`: the tiles could win with a yaku but aren't in a valid order ("Tiles OK, reorder")
  - `shanten`: shows `n`-shanten, or "Tenpai" for 0
- `groups` (for the colored boxes): the winning parse for a complete row (the wait group is marked
  `wait`, drawn dashed), otherwise the best non-overlapping contiguous sets/pairs per run (`findGroups`).

### 4.5 Ordering rule (`rules = { order }`)
- `order`: **'strict'** (default: left to right, sequences ascending), **'reverse'** (left to right, each
  sequence and partial sequence may be ascending or descending: 4-5-6 or 6-5-4, never 5-4-6), **'any'**
  (the right tiles in any arrangement). Labels live in `ORDER_RULES` (config).
- `evaluateRow(board, r, rules)` / `evaluateBoard(board, rules)` / `generatePuzzle(seed, difficulty, rules)`.
  Defaults: `UI.orderDefault`, `MULTIPLAYER.order`. Solo remembers it (localStorage `jong-jumble.order`),
  share links carry `&order=reverse|any`, 1v1 sends it in `roundStart`.
- 'any': a row wins when its loose tiles + winning tile form 4 sets + pair (or seven pairs / kokushi), with a
  yaku. Open sets still count and stay whole. `unorderedParses` tries every group the winning tile could have
  completed and derives the wait for fu and pinfu, so scoring matches a sorted win. `reorder` can't happen.
- Hint boxes accept descending sequences whenever the rule isn't 'strict'.
- The generator passes the rule to the scramble, so a puzzle never starts with a row already solved under it.

---

## 5. Puzzle generation (`js/core/generator.js`, `js/core/rng.js`)

- **Seed:** a string. Empty → random string (shown to the user so they can share it). Hash it with
  cyrb128, then use sfc32/mulberry32 as the PRNG. **All** randomness goes through this PRNG, so the
  same seed + difficulty gives the same puzzle everywhere (this is required for multiplayer).
- **Solved board:**
  1. Pick a round wind; seat winds follow the row index.
  2. For each row: decide the number of open sets from the difficulty (e.g. Easy 0–1, Hard 0–2). Build a
     random 4-sets + pair hand that respects the per-row tile limits. Sprinkle red fives by chance. If it has open
     sets, re-roll until `hasYaku` (bias the generation toward yakuhai / tanyao / honitsu so it doesn't loop).
     A small chance of a chiitoitsu hand when closed.
  3. Lay the row out as sorted closed groups. Remove one random tile from one random group (the wait);
     it becomes the row's fixed winning tile. Open melds go as chains at the right end of the playfield,
     each with one random sideways tile.
- **Scramble:** apply N random **legal** moves (no immediate inverse). Re-roll if the result
  already has any solved row. Suggested N: Easy 20, Medium 40, Hard 70 (tune by playtesting).
- **Save** `{ seed, difficulty, scrambleMoves }` for display/debug. There are many valid solutions
  (any multiset arrangement works), so the scramble length is **not** shown as par.

---

## 6. UI (`index.html`, `css/`, `js/ui/`)

**Look:** matches the title screen: white page, ink `#2a2a2a`, chun red `#c54749`, hatsu green, and "stretched
tile" frames (4px gold rim `#baa30b` + grey inner rim `#bbb`) on buttons, inputs, dialogs and the board.
Headings, buttons, labels and numbers use the self-hosted pixel font **Silkscreen** (`assets/fonts/`, OFL);
body text stays in the system font for readability. Colors live as CSS variables at the top of `css/style.css`.

**Flow** (`js/main.js`): title screen → **Solo** → **setup dialog** (seed, difficulty, controls, hints, Play) →
board. Nothing is generated until Play. **Menu** reopens the setup dialog with Resume / New game (the timer is
paused while it's open); **Title** / Esc (with no game) returns to the title screen. Shared `?seed=` links skip
straight to the board. Last difficulty, controls and hints are remembered (localStorage `jong-jumble.*`).

**Top bar:** logo (`assets/home/logo.png`, the title art; click = title screen), **Menu** and **How to play**
(help dialog) next to it; then stats (round, moves, time, seed) and Undo / Restart / New (Reset for typed seeds).

**Board:** as large as fits (up to 32 × `UI.tileScale` = 96 px tiles), centered in the space under the top bar.
- Layout: left arrows | 13-column playfield (no gaps between tiles, small gap between rows) | **Win** column
  (fixed winning tiles, red outline, green when the row is solved) | right arrows | row info. Up/down arrows
  above/below each playfield column only.
- Open sets ("locked"): greyer, one tile rotated sideways (clockwise). The 3 tiles shrink as one group
  (`--locked-scale` in CSS) so they touch each other but not the neighbouring tiles.
- **Group boxes** (hints on): pair yellow, triplet green, sequence blue; dashed = the wait group.
- **Wait boxes** (hints on): a red box around each partial group the row's winning tile would complete
  (`findWaitGroups` → `evaluateRow().waits`: an adjacent pair of it, a lone copy, or two adjacent ascending
  tiles it turns into a sequence). Drawn slightly inset so they show inside the colored group boxes. A solved
  row shows only its actual wait group.
- Hovering an arrow highlights what will move. Blocked column arrows are grey and show the blocked columns.
- **Keyboard:** hover a tile, then W/Up S/Down move its column, A/Left D/Right move its row. Ctrl+Z = undo.
- **Control modes** (setup dialog; in MP the host picks one mode for both players):
  - `shift`: arrows, keyboard, or **drag a tile**. The first direction dragged locks the axis, and each full tile
    dragged applies one row/column shift live (each counts as a move).
  - `drop`: arrows and keys disabled. Click tiles to build an adjacent selection in one row (clicking an open
    set selects all 3; clicking an end tile of the selection removes it; a non-adjacent click starts over).
    Drag the selection: onto another row = **swap** with the tiles there; within its row = **reorder** (the gap
    closes), or with the **Same-row drops: swap** option (`dropSwap`) trade places with the tiles there
    (overlapping ranges are refused). Target preview is green if legal, grey if it would split an open set
    (then it snaps back).
    Each drop = 1 move: `{ type: 'drop', from: { row, start, len }, to: { row, col } }` (see §3.1).
- Beside each row: seat wind badge, then Tenpai / n-shanten / "Tiles OK, reorder" / "No yaku" / ✓ points
  (yaku, han and fu on hover).
- **Win dialog:** score (§6.1), moves, time, seed, per-row points and yaku, share link.
- Moves are animated with FLIP slides; wrapped tiles slide in from the edge.

### 6.1 Scoring (edit in `js/config.js` → `SCORING`; `js/core/scoring.js` only wraps it)
```
score = ( Σ over rows of handPoints ) / max(1, seconds − 30)
```
- `handPoints` = each solved row's tsumo value in points (§4.2b). Solving within 30 s (`graceSeconds`) keeps
  the full hand total; after that it is divided by the extra seconds.
- `formula()` also receives `moves` and `shantenSum` (Σ over rows of start shanten + 1) so they can be
  added back later; they are currently unused. Undo still counts as a move.
- An unsolved round (MP time-out) scores **0**. The display rounds to an integer (`SCORING.round`).
- `computeScore({ startShanten[], handPoints[], moves, seconds, solved })` in `js/core/scoring.js` is the only
  caller. SP, MP clients, and the server all use it.
- The URL carries `?seed=…&d=easy|medium|hard`.

---

## 6.2 Home screen (`js/ui/home.js`, `assets/home/`)
- Matches the user's 1920×1080 mockup: authored on a 1920×1080 `.home-stage` that JS scales to fit the window
  (anchored left, centered vertically; the wall bleeds right/up/down for other aspect ratios).
- Title and button labels are pixel art extracted from the mockup (`assets/home/*.png`, alpha = ink coverage so
  anti-aliased edges match). The buttons are CSS "stretched tiles": 4px gold rim (#baa30b) + 3px grey inner rim.
- **Wall:** 20 × 14 random tiles (sprites at 128 px) on a plane transformed by a `matrix3d` homography fitted to
  the mockup's tile seams (mean error 0.55 px). Every ~1.1 s (`HOME` in config) a random visible row or column
  shifts by one with a slide; wrapped tiles slide in from outside the wall edge. Off with prefers-reduced-motion.
- Flow: the home screen shows on launch; **Solo** → game; **1v1** → "coming soon" until multiplayer exists.
  The in-game title returns home. Shared links with `?seed=` skip the home screen.

## 7. Multiplayer: live head-to-head (`server/`, `js/net/`) ✅

- **Server:** `server/server.js` = static files + `ws` WebSocketServer on path `/ws` (16 KB max message,
  30 s ping/pong heartbeat drops dead connections). All match rules live in `server/rooms.js`
  (`createRoomManager({ now, schedule, cancel })`, transport-agnostic and unit-tested with a fake clock in
  `tests/rooms.test.js`).
- **Protocol:** `js/net/protocol.js` documents every message and holds `sanitizeSettings` / `sanitizeName`,
  shared by client and server.
- **Room flow:** host `create`s → 5-char code (no 0/O/1/I) → guest `join`s (case-insensitive) → host
  `configure`s (difficulty, rounds 1/3/5/7/9, time per round 1-10 min, controls, same-row swap, tile order,
  hints, seed; any change
  un-readies both) → both `ready` → match.
- **Rounds:** round seed = `deriveSeed(matchSeed, r)`; matchSeed = host's seed or random. Server sends
  `roundStart` with `startAt` + `serverNow` (clients convert to their own clock), a 3 s countdown
  (`MULTIPLAYER.countdownSec`), then the time limit. Moves before `startAt` are ignored.
- **Authoritative replay:** the client applies moves locally and sends them; the server applies the same move
  to its copy (`applyMove`), only accepting moves of the host's control mode and forcing drops to the host's
  `dropSwap` setting. An illegal move gets `sync { board, moves }` back. Undo = `undo` (counts as a
  move). The server detects the solve itself.
- **Hidden scores:** during the match clients only see `progress { player, moves, solved }`. A round ends when
  both solved or time runs out (unsolved = 0). After `roundBreakSec` the next round starts; after the last one
  the server sends `matchEnd` with the full table (score, moves, seconds, points per round), totals and winner.
  Ties: `MULTIPLAYER.tiebreak` ('fewerSeconds' = less total time; unsolved rounds count as the full limit).
- **Leaving:** leaving or disconnecting mid-match forfeits (the opponent wins, `forfeit: true`). The room
  survives with the remaining player (who becomes host); an empty room is deleted. After a match, Rematch
  = ready again in the same room.
- **Client:** `js/net/versus.js` (dialogs: connect → lobby; leave confirm; results) drives the shared board
  through a small `game` API in `js/main.js` (startRound / syncBoard / lockBoard / endVersus / overlays).
  In a round: Menu becomes **Leave**, Restart/New are hidden, the clock counts down, the top bar shows the
  match round and the opponent's moves / solved state, and a board overlay shows the countdown and
  "Solved! Waiting for …". Hints and controls come from the host's settings (not saved as your own).
- Not implemented: reconnecting to a running match after a disconnect.

## 8. File layout

```
index.html
css/style.css
sprites/*.png                # user-supplied 32x32 art (see §2 for the name mapping)
js/config.js                 # ALL tunable defaults + scoring formula
js/main.js                   # bootstraps the game and wires the UI to state
js/core/tiles.js             # tile IDs, helpers, TILE_IMAGES map
js/core/rng.js               # seed hashing + PRNG
js/core/board.js             # board model, applyMove, canMove, inverse
js/core/hand.js              # decomposition, shanten
js/core/yaku.js              # yaku detection, ordered win rule, group finding
js/core/points.js            # han / fu / tsumo points
js/core/generator.js         # solved board + scramble
js/core/scoring.js           # computeScore (wraps config SCORING)
js/ui/render.js              # DOM board, arrows, chains, animations
js/ui/hud.js                 # top bar, setup / help / win dialogs
js/ui/home.js                # home screen: title, Solo/1v1, animated perspective wall
assets/home/*.png            # title / label / icon art extracted from the home mockup, logo.png
assets/fonts/                # Silkscreen pixel font (OFL)
js/net/protocol.js           # 1v1 message list + settings/name sanitizing (shared)
js/net/versus.js             # 1v1 client: connection, lobby, rounds, results
server/server.js             # static server + WebSocket endpoint /ws
server/rooms.js              # 1v1 rooms, rounds, authoritative replay, scoring
tests/*.test.js              # node --test
package.json                 # "ws" dependency, scripts: start, test
```

`js/core/*` must stay **pure and DOM-free** so the server and the tests can import them.

---

## 9. Build phases

1. ✅ **Core logic + tests:** tiles, rng, board moves, hand decomposition, shanten, yaku, generator,
   scoring, config, hand points, wait boxes, drag & drop moves, ordering rules, same-row swap, server move enforcement. 44 tests, including the reference-image hands, the ordering rules, hand
   values, and a 2000-move inverse random walk.
2. ✅ **Rendering + controls:** `js/ui/render.js` (DOM tiles with absolute positions, FLIP slide animation,
   wrapped tiles slide in from the edge, hover highlights, blocked arrows).
3. ✅ **Generator UI:** seed input, difficulty picker, URL params (`?seed=&d=`, seed only when typed).
4. ✅ **HUD / QoL:** `js/ui/hud.js` + `js/main.js`: moves, timer, undo, Restart, New/Reset, hints toggle
   (localStorage), row status, scoring, win dialog with share link.
5. ✅ **Art:** all sprites wired in, red fives included.
6. ✅ **Multiplayer:** server, rooms, host settings, best-of-N rounds with time limits, authoritative replay,
   hidden scores, end-of-match reveal, forfeit, rematch. `tests/rooms.test.js` covers the room logic.
7. **Polish:** sound, mobile layout, touch controls, tuning scramble depth.

## 10. Commands
- Play: `npm install` once, then `npm start` → http://localhost:8080 (static files + 1v1 on `/ws`, reads `PORT`).
  Single player also works from any static server; ES modules don't work over `file://`.
- Tests: `npm test` (`node --test "tests/**/*.test.js"`). Run them after any change in `js/core/` or `js/config.js`.

## 11. Repo and deploy
- Git, branch `main`. Keep the repo root deployable as-is: no build step, and no generated files committed.
- Full deploy: one Node web service (`npm install`, `npm start`); `render.yaml` is a ready Render blueprint.
  SP-only deploy: static hosting of the repo root (1v1 then unavailable).
- See README.md for details.

## 12. Open questions / tuning
- Phone width: the board is ~15 × 24 px wide at minimum and scrolls horizontally. It needs a mobile layout (phase 7).
- Scrambled starts currently sit at roughly 0–2 shanten per row. Tune `scrambleMoves` and `openSetWeights` in
  playtesting. The defaults in `js/config.js` are: 3 rounds, 180 s round limit, tiebreak = fewer total seconds.
