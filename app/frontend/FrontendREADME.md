# OMS Trading Terminal — Frontend

A React + TypeScript trading terminal for a practice Order Management System. It renders a
live depth ladder, a trade tape, and a manual order-entry / open-orders panel, driven
entirely by a single WebSocket connection to the Java backend — no polling, no REST.

This is the frontend edge of a full-stack portfolio project. The backend is a low-latency,
lock-free matching engine (LMAX Disruptor ring buffers, a hand-rolled FIX tag-value gateway,
a Netty WebSocket server); this app *consumes* its `BOOK`/`EXEC` frames and *produces*
`NEW`/`CANCEL` frames. It adds no trading behaviour of its own.

---

## Architecture

The frontend is a pure protocol edge over one socket. Outbound, an order flows
`React form → NEW/CANCEL JSON (integer cents) → WebSocket`; server-side that JSON is
transcoded to FIX 4.2, framed onto the inbound Disruptor ring, matched by the single-threaded
engine, and the results are published back onto the outbound and snapshot rings, reserialized
to JSON, and pushed to every connected client. Inbound, the app narrows each raw frame in
exactly one place (`protocol/messages.ts`), a pure reducer (`state/reducer.ts`) folds frames
into `{ book, tape, myOrders, connection }`, and a single `useOrderBook` hook owns the socket
lifecycle (connect, capped-backoff reconnect, dispatch). Every price is an integer number of
cents internally and on the wire; dollars exist only at the render/parse edge, converted with
string arithmetic so no floating-point error ever reaches a price. **`BOOK` frames are the
sole authority on book state; `EXEC` frames are notifications only** — the two never
cross-contaminate.

---

## Screenshots

<!-- Capture on a running stack (backend on :8080, frontend on :5173) and drop the files in docs/img/ -->

- **Populated depth ladder + Live badge** — after placing a resting order
  `![Depth ladder](docs/img/ladder.png)`
- **A fill in the trade tape** — after crossing that order
  `![Trade tape](docs/img/tape.png)`
- **Open orders with a cancellable row**
  `![Open orders](docs/img/open-orders.png)`
- **Short GIF: place → cross → cancel round-trip**
  `![Round-trip demo](docs/img/demo.gif)`

---

## Running the stack

Bring up the backend first, then the frontend. The frontend connects on load and will sit in
a reconnecting state until the server is up.

### 1. Backend (Java matching engine + WebSocket server)

The server's entry point is `Main` at the root of `src/main/java` (no package). It binds
`ws://localhost:8080/ws` and logs the endpoint plus copy-pasteable sample order JSON on
startup.

- **From IntelliJ (recommended):** open the Maven project at `app/backend/`, let it sync
  dependencies, then run `Main` via the green gutter arrow (or right-click → *Run 'Main'*).
- **Port:** defaults to `8080`; override with a single program argument
  (e.g. run config program arguments `9090`, or `<arg>` on the CLI). Unparseable input logs a
  warning and falls back to `8080`.
- **CLI alternative:** if the `exec-maven-plugin` is configured in the pom,
  `mvn compile exec:java -Dexec.mainClass=Main` runs it from a terminal. If that goal isn't
  wired, use the IntelliJ run above (it assembles the classpath — Netty, Jackson, Disruptor,
  SLF4J — for you).

The endpoint the frontend expects: **`ws://localhost:8080/ws`** (no TLS — `ws://`, not
`wss://`; §3.6, demo only).

### 2. Frontend (this app)

Requires **Node 20.19+ or 22.12+** (Vite 8). Check with `node -v` first.

```bash
cd app/frontend      # run every command from inside app/frontend/, never the repo root
npm install          # first run only; commits package-lock.json
npm run dev          # → http://localhost:5173
```

Other scripts:

```bash
npm test             # vitest run — the P5-0..P5-5 pure + component suites
npm run test:watch   # vitest in watch mode
npm run build        # tsc (strict typecheck) && vite build
```

The socket URL is read from `app/frontend/.env`:

```
VITE_WS_URL=ws://localhost:8080/ws
```

If unset, `useOrderBook` falls back to that same default, so the app works out of the box
against a local backend on the default port. Point `VITE_WS_URL` elsewhere to target a
different host/port.

---

## Wire contract

Single instrument (`ASML`). **Integer cents in both directions — no floats on the wire.**
No symbol/heartbeat/session fields on outbound server frames (no FIX session management).

### Client → server

```jsonc
// NEW — price is integer cents; server transcodes cents → FIX decimal dollars
{ "type": "NEW", "clOrdId": 1, "side": "BUY", "price": 15000, "qty": 10, "symbol": "ASML" }

// CANCEL — origClOrdId is the resting order being cancelled
{ "type": "CANCEL", "clOrdId": 3, "origClOrdId": 1 }
```

### Server → client

```jsonc
// BOOK — authoritative, wholesale book state; top-10 levels/side, valid prefix only.
// -1 tops and empty arrays on an empty side. bids highest-first, asks lowest-first.
{
  "type": "BOOK",
  "bestBid": 15000,
  "bestAsk": -1,
  "bids": [[15000, 10]],
  "asks": [],
  "timestamp": 123456789
}

// EXEC — all nine fields ALWAYS present; -1 for not-applicable (keys are never omitted).
// execType is the full enum name.
{
  "type": "EXEC",
  "execType": "ORDER_FILLED",
  "orderId": 2,
  "tradeId": 1,
  "price": 15000,
  "filledQuantity": 4,
  "remainingQuantity": 0,
  "aggressorOrderId": 2,
  "passiveOrderId": 1,
  "timestamp": 123456790
}
```

`execType` is one of `ORDER_ACCEPTED`, `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`,
`ORDER_CANCELLED`, `ORDER_REJECTED`.

### Correlation facts (confirmed against the backend, not assumed)

- **The client owns order IDs.** `clOrdId` is monotonic, numeric, seeded at `Date.now()`, and
  generated in exactly one place. It is echoed back as EXEC `orderId`
  (a `BUY` sent as `clOrdId 1` returns `ORDER_ACCEPTED orderId 1`).
- **On a fill, EXEC `orderId` is the aggressor** (incoming) order; `aggressorOrderId` /
  `passiveOrderId` name both sides; `price` is the **passive resting price**;
  `remainingQuantity` is the aggressor's remaining size.
- **`ORDER_CANCELLED` carries `orderId == origClOrdId`** — the cancelled resting order's id,
  not the cancel request's own `clOrdId`.

---

## Behaviour you should know (honest caveats)

These are real properties of the running system, documented rather than glossed:

- **`BOOK` is authoritative; `EXEC` is a notification.** EXEC and BOOK arrive on independent
  Disruptor consumers with separate sequence counters, so **they can interleave out of order**
  — a BOOK can be written before an EXEC with an earlier timestamp. The client never infers
  book state from EXEC arrival order and never merges EXEC into the book. This is the single
  load-bearing constraint of the frontend.
- **A passive resting order receives no EXEC of its own.** The engine fires one fill event per
  trade, naming only the aggressor. When your resting order is partially consumed by someone
  else's incoming order, you get **no EXEC** — the consumption is visible only as the depth
  ladder shrinking on the next BOOK. Consequently the Open Orders panel keeps a resting row at
  its last known status/remaining until it is cancelled (or silently disappears from the book
  when fully consumed). Per-passive fill reporting would be a server change and is out of
  scope.
- **A freshly (re)connected client sees an empty ladder until the next order event.** The
  server pushes a BOOK only per inbound event; there is no snapshot-on-connect message
  (deliberately out of scope). Place any order and the ladder repopulates. On a socket drop the
  client clears the book (a stale ladder is worse than an empty one) and reconnects with
  exponential backoff.
- **`timestamp` is `System.nanoTime()`, not epoch time.** Despite the `<epochNanos>` label
  used in the build guides, the backend stamps frames from a monotonic clock with an arbitrary
  origin (the value can even be negative). It is valid only for relative ordering — **it cannot
  be rendered as wall-clock time**, so the UI shows no absolute timestamps. Treat the guides'
  `<epochNanos>` wording as inaccurate on this point.
- **No server reject feedback for malformed input.** Bad orders are logged and dropped
  server-side with no message back to the client, so the UI validates price/quantity locally
  before sending (`> 0`, `≤ 2` decimal places, positive integer qty). `ORDER_REJECTED` can
  still arrive (e.g. cancelling an unknown order) and is handled if it does.

---

## Manual end-to-end checklist

Run against the live backend (`Main` on `:8080`) with the frontend on `:5173`. This is the
Phase 5 acceptance gate. (The `npm test` suites from P5-0..P5-5 should already be green as a
precondition; they cover the pure logic and component rendering, but the round-trip below is
what closes the phase.)

1. **Start both.** Backend up on `:8080`, `npm run dev` up on `:5173`, browser open on
   `http://localhost:5173`.
2. **Connect.** The connection badge shows **Live**.
3. **Place a resting order** — e.g. `BUY 10 @ 150.00`.
   - Depth ladder populates with a bid level `150.00 × 10`.
   - Open Orders shows a row: your `clOrdId`, `BUY`, `150.00`, remaining `10`, status
     **OPEN** (from `ORDER_ACCEPTED`, `orderId == clOrdId`).
4. **Cross it** — e.g. `SELL 4 @ 150.00`.
   - Trade tape shows a fill (`4 @ 150.00`).
   - Depth ladder bid reduces `10 → 6`.
   - The aggressor's EXEC status is reflected; the resting row's remaining follows the book.
5. **Confirm out-of-order handling holds.** The visible book always matches the latest **BOOK**
   frame — never reconstructed from EXEC ordering. (Watch the console: a BOOK may land before
   its own EXEC; the ladder stays correct regardless.)
6. **Cancel the resting order** — Cancel the `BUY` row.
   - Row closes on `ORDER_CANCELLED` (`orderId == origClOrdId`).
   - Depth ladder empties that level (`bestBid → —`).
7. **Malformed input is blocked locally.** Try `150.255` (>2 decimals) or qty `0` — the order
   is rejected in the UI with a visible reason and **no frame is sent** (nothing appears in
   Open Orders, nothing on the server).
8. **Disconnect / reconnect.** Stop the backend, then restart it.
   - Badge transitions to **Reconnecting**, then back to **Live** when the server returns.
   - The ladder **clears** on disconnect and stays empty until you place the next order, which
     repopulates it (the known no-snapshot-on-connect limitation).

If every step behaves as above, the round-trip is proven end to end and Phase 5 is complete.

---

## Known limitations

- **No snapshot-on-connect.** A fresh client sees an empty ladder until the next order event
  (out of scope; §5.6).
- **No per-passive fill reporting.** A resting order's partial consumption by others is not
  individually reported to the client — visible only as the book shrinking.
- **No wall-clock timestamps.** `timestamp` is a monotonic `System.nanoTime()` value, usable
  only for ordering.
- **No reject feedback path.** Malformed input is guarded client-side; the server silently
  drops bad frames.
- **Single instrument, no session management, no auth, no persistence** — all out of scope for
  this practice build.

---

## Project layout

```
app/frontend/
  src/
    protocol/     # messages.ts (wire discriminated unions, parseServerFrame), encode.ts
    state/        # reducer.ts (pure), useOrderBook.ts (socket lifecycle)
    components/   # Header, ConnectionBadge, DepthLadder, TradeTape, OrderEntry, OpenOrders
    format.ts     # cents <-> dollars, string-based; sentinel -> "—"
    App.tsx       # single-screen layout around one useOrderBook instance
    styles/       # terminal theme
  test/           # vitest: format, protocol, reducer, and component render suites
```
