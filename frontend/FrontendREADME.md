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

- **From IntelliJ (recommended):** open the Maven project at the repo root, let it sync
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
cd frontend          # run every command from inside frontend/, never the repo root
npm install          # first run only; commits package-lock.json
npm run dev          # → http://localhost:5173
```

Other scripts:

```bash
npm test             # vitest run — the P5-0..P5-5 pure + component suites
npm run test:watch   # vitest in watch mode
npm run build        # tsc (strict typecheck) && vite build
```

The socket URL is read from `frontend/.env`: