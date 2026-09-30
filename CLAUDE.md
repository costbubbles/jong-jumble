# Mahjong Rows — riichi hand sliding puzzle (HTML5)

A browser puzzle game. The board is a grid of mahjong tiles with **R rows × 14 columns**. Arrow controls on
the edges rotate rows and columns (wrapping around). The puzzle is solved when **every row is a valid
riichi winning hand with at least one yaku**.

This file is the design spec and the build plan. Keep it up to date when decisions change.

---

## 1. Decisions (confirmed with the user)

| Topic | Decision |
|---|---|
| Columns | **14** per row. The **last loose (non-chain) tile** in each row is the drawn/winning tile (red outline). It completes the row's one incomplete group, wherever that group is (§4.4). |
| Hand validity | Winning shape **in a valid left-to-right order** (§4.4) **and at least 1 yaku**. |
| Yaku context | Fully closed rows count as **riichi** (so they always have a yaku). Rows with an open set need a real yaku. Each row has its own **seat wind**; the **round wind** is shared by the puzzle. The win is always treated as **tsumo**. |
| Open sets | **Pon + chii only** (3-tile chains, no kans). Chains can never be split. |
| Row wrap | A chain wraps **as one unit** (see §3.2). |
| Chain clash on vertical move | **Blocked**: the arrow is disabled (see §3.3). |
| Tile limits | **Per row, at generation time only**: at most 4 copies of a tile (red 5 counts as 5) and at most one red five per suit. The grid as a whole may exceed a real set. Rows mix during play, so the validity checks don't enforce these limits. |
| Scramble | Start from solved rows and apply **N random legal moves**. Always solvable. |
| Modes | **Seed input** (empty = random) + difficulty **Easy / Medium / Hard = 2 / 3 / 4 rows**, and **live head-to-head multiplayer**. |
| QoL | Move counter, timer, undo, per-row validity glow, **per-row shanten counter** (+ "no yaku" flag), **Restart** and **New/Reset** buttons (§6). |
| Config | **Every tunable default lives in `js/config.js`**: the scoring formula, difficulty presets, generation weights, UI, and multiplayer defaults. Don't hard-code tunables elsewhere. |
| Scoring | One formula for SP and MP, defined in `js/config.js` → `SCORING` (§6.1). |
| Multiplayer match | **Best of N rounds.** All N rounds are always played; scores stay hidden until the end. Each round has a host-set time limit; an unsolved round scores 0. The host toggles hints. |
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
  cols: 14,
  cells: Cell[R][14],            // Cell = { tile: TileId, chain: string|null }
  roundWind: '1z'..'4z',
  seatWinds: TileId[R]           // belongs to the row position: row i -> East, South, West, North
}
```
The chain type (pon/chi) is derived from its tiles (`meldType`). For tests and fixed levels, build
boards from notation: `createBoard({ rows: ['406s 345p 99p 564m [222z]'] })`, where brackets mark a chain.

A chain always occupies **3 horizontally adjacent cells in one row** (never wrapped across the edge).
Whatever row a chain sits in, it counts as an open set **of that row**. Chains can move between
rows through vertical moves.

All moves are **pure functions** `(board, move) -> board | null` (null = illegal) in `js/core/board.js`.
Every legal move has a legal exact inverse, so a board scrambled by random moves is always solvable
by reversing them.

### 3.1 Move types
- `{ type: 'row', row, dir: 'left'|'right' }`
- `{ type: 'col', col, dir: 'up'|'down' }`

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

Per row: `openMelds` = chains in the row (k of them), `closed` = the other 14 − 3k tiles.
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
- Closed-only extras (display only): Iipeikou, Ryanpeikou, Suuankou, Chiitoitsu, Kokushi.
  **Pinfu is not detected**, because the winning tile/wait is cosmetic.
- Output of `evaluateHand` / `evaluateRow`: `{ shanten, complete, hasYaku, solved, yaku: string[] }`

### 4.3 Shanten
Standard shanten per row. With k open melds, compute it on the closed tiles with 4 − k sets needed.
Take the minimum over regular / chiitoi / kokushi (the last two only when k = 0). **Order is ignored.**

### 4.4 Ordered win rule (`evaluateOrdered` in `js/core/yaku.js`)
- The **drawn tile** is the **last loose tile** in the row (chains to its right are fine).
- The other loose tiles are read left to right. **Chains split them into separate runs**, so a group
  can't span across a chain. Each run must split into contiguous groups:
  - **Sequence:** ascending only (4-5-6 ✓, 6-5-4 ✗, 5-4-6 ✗). A red 5 counts as 5.
  - **Triplet:** 3 identical tiles in any order (red 5 = 5).
  - **Pair:** 2 identical tiles, side by side.
- There is **exactly one wait group**, which the drawn tile completes: a single tile (tanki → pair), a pair
  (shanpon → triplet), or two ascending tiles (ryanmen/penchan/kanchan → sequence).
- Totals: 4 sets (chains included) + 1 pair. **Chiitoitsu:** 7 distinct adjacent pairs (one of them is the
  tanki). **Kokushi:** any order.
- Row status (`evaluateRow`):
  - `solved`: ordered win with a yaku (the row glows)
  - `noyaku`: the tiles win but no yaku is possible
  - `reorder`: the tiles could win with a yaku but aren't in a valid order ("Tiles OK, reorder")
  - `shanten`: shows `n`-shanten, or "Tenpai" for 0

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
  3. Lay the row out as sorted closed groups. Remove one random tile from one random group (the wait)
     and place it as the drawn tile after the closed groups. Open melds go as chains at the right end
     (like the reference image).
- **Scramble:** apply N random **legal** moves (no immediate inverse). Re-roll if the result
  already has any solved row. Suggested N: Easy 20, Medium 40, Hard 70 (tune by playtesting).
- **Save** `{ seed, difficulty, scrambleMoves }` for display/debug. There are many valid solutions
  (any multiset arrangement works), so the scramble length is **not** shown as par.

---

## 6. UI (`index.html`, `css/`, `js/ui/`)

- The layout matches the reference image: a dark board panel, arrows above every column (up) and below it (down),
  and left/right arrows beside every row. Chains are drawn joined, with a teal frame around the 3 tiles.
  Each row's drawn tile is outlined red.
- Hovering an arrow highlights what will move. Blocked column arrows are grey and show the blocked columns.
- Beside each row: seat wind badge, then Tenpai / n-shanten / "Tiles OK, reorder" / "No yaku" / ✓ Win
  (the yaku list shows on hover). The round wind is shown in the header.
- Ctrl+Z = undo.
- **HUD:** seed field + difficulty selector, move counter, timer (starts on the first move), Undo.
  - **Restart:** the same puzzle, back to its scrambled start (clears the move history, timer, and move count).
  - **New / Reset:** if the seed was **random/empty**, roll a new seed and generate; if the user
    **typed a seed**, behave like Restart.
- **Win:** once all rows are solved, show a modal with the score (§6.1), moves, time, seed, and a share link.
- **Hints toggle:** the row glow, shanten counter, and "no yaku" marker can be turned off (SP setting;
  in MP the host decides).

### 6.1 Scoring (edit in `js/config.js` → `SCORING`; `js/core/scoring.js` only wraps it)
```
score = ( (Σ over rows of (startShanten + 1)) / moves ) × ( 10 + max(0, floor(100 − seconds)) ) × 1000
```
- `startShanten` = each row's shanten on the **scrambled starting board** (computed at generation time).
  The +1 per row means a row that starts at 0-shanten still counts for 1.
- `moves` = the moves made (undo counts as a move, so it can't be exploited). It is always ≥ 1 because
  the scramble never produces a solved row.
- `seconds` = time from the first move to the solve. The time term is clamped, so it stays ≥ 10.
- An unsolved round (MP time-out) scores **0**.
- `SCORING` holds `base = 10`, `timeCap = 100`, `multiplier = 1000`, `formula()`, and `round`.
  `computeScore({ startShanten[], moves, seconds, solved })` in `js/core/scoring.js` is the only
  caller. SP, MP clients, and the server all use it.
- The URL carries `?seed=…&d=easy|medium|hard`.
- Blocked arrows are dimmed. Moves are animated with CSS transforms (short slide; an input queue while animating).
- Arrow keys/touch are not in v1 (possible later).

---

## 7. Multiplayer: live head-to-head (`server/`, `js/net/`)

- `server/server.js`: Node + `ws`. It serves the static files and manages **rooms**.
- **Host settings:** difficulty, match seed (empty = random), **rounds N**, **round time limit**,
  **hints on/off** (applies to both players).
- **Flow:** the host creates a room → gets a room code → shares it → the opponent joins → the host configures
  the match → both are ready → for each round r = 1..N the server sends `roundStart { round, seed, startAt }`, where
  the round seed is derived from the match seed + r. Both players get the same puzzle, with a countdown before it starts.
- **During a round:** the client sends every `move`. The server **replays it with the shared `js/core` modules**
  (authoritative, prevents cheating) and uses its own clock. Opponent progress is broadcast as moves and
  "solved / still playing" only. **No scores are shown during the match.** Neither player sees the other's board.
- **Round end:** each player plays until they solve it or the time limit runs out. The round ends when both are
  done. The server computes each round score with `computeScore` (0 if unsolved).
- **Match end:** after **all N rounds** (there is no early finish, even if the result is already decided), reveal
  a per-round score table plus the totals. The highest total wins. Offer a rematch.
- **Messages (JSON):** `create`, `join {code}`, `configure {settings}`, `ready`, `roundStart`,
  `move {move}`, `progress {player, moves, solved}`, `roundEnd {round}`,
  `matchEnd {table, totals, winner}`, `leave`, `error`.
- Reconnect (resume by room code + player token) is optional.

---

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
js/core/yaku.js              # yaku detection
js/core/generator.js         # solved board + scramble
js/core/scoring.js           # computeScore (wraps config SCORING)
js/ui/render.js              # DOM board, arrows, chains, animations
js/ui/hud.js                 # seed/difficulty, counters, buttons, win modal
js/net/client.js             # WebSocket client + lobby UI
server/server.js             # static server + rooms + authoritative replay
tests/*.test.js              # node --test
package.json                 # "ws" dependency, scripts: start, test
```

`js/core/*` must stay **pure and DOM-free** so the server and the tests can import them.

---

## 9. Build phases

1. ✅ **Core logic + tests:** tiles, rng, board moves, hand decomposition, shanten, yaku, generator,
   scoring, config. 25 tests, including the reference-image hands, the ordering rules, and a 2000-move
   inverse random walk.
2. ✅ **Rendering + controls:** `js/ui/render.js` (DOM tiles with absolute positions, FLIP slide animation,
   wrapped tiles slide in from the edge, hover highlights, blocked arrows).
3. ✅ **Generator UI:** seed input, difficulty picker, URL params (`?seed=&d=`, seed only when typed).
4. ✅ **HUD / QoL:** `js/ui/hud.js` + `js/main.js`: moves, timer, undo, Restart, New/Reset, hints toggle
   (localStorage), row status, scoring, win dialog with share link.
5. ✅ **Art:** all sprites wired in, red fives included.
6. **Multiplayer:** server, rooms, host settings, best-of-N rounds with time limits, authoritative replay,
   hidden scores, end-of-match reveal.
7. **Polish:** sound, mobile layout, keyboard/touch, tuning scramble depth.

## 10. Commands
- Play: `npm start` → http://localhost:8080. `server/server.js` is a zero-dependency static server (reads `PORT`)
  that gets WebSocket rooms in phase 6. Any static server also works; ES modules don't work over `file://`.
- Tests: `npm test` (`node --test "tests/**/*.test.js"`). Run them after any change in `js/core/` or `js/config.js`.

## 11. Repo and deploy
- Git, branch `main`. Keep the repo root deployable as-is: no build step, and no generated files committed.
- SP-only deploy: static hosting of the repo root. Full deploy: one Node web service running `npm start`.
- See README.md for details.

## 12. Open questions / tuning
- Phone width: the board is ~14 × 32 px wide at minimum and scrolls horizontally. It needs a mobile layout (phase 7).
- Scrambled starts currently sit at roughly 0–2 shanten per row. Tune `scrambleMoves` and `openSetWeights` in
  playtesting. The defaults in `js/config.js` are: 3 rounds, 180 s round limit, tiebreak = fewer total seconds.
