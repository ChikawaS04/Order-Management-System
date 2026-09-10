/**
 * The pure state core. No React, no socket, no side effects.
 *
 * Two rules dominate, both inherited from Phase 4:
 *
 *  1. BOOK is authoritative book state and replaces bids/asks/tops wholesale.
 *     EXEC never touches the book. The two streams are independent Disruptor
 *     consumers with separate sequence counters and interleave unpredictably,
 *     so book state can never be inferred from EXEC arrival order.
 *
 *  2. A passive resting order that is hit receives NO EXEC of its own. The
 *     engine fires one onFill per trade, naming the aggressor, and is silent on
 *     the passive side. Per-order fill progress therefore is not trackable for
 *     resting orders: such a row keeps its last known status and remaining
 *     quantity until it is cancelled (or silently vanishes when fully consumed,
 *     visible only as the book shrinking). This is a documented backend gap, not
 *     a client bug; a per-passive EXEC would be a server change and is out of
 *     scope.
 *
 * Ordering WITHIN the EXEC stream is reliable (one ring, one sequence), so a
 * PARTIALLY_FILLED followed by its trailing ACCEPTED can be trusted.
 *
 * P7-3 adds the session state the header renders: sessionVolume, sessionOpenCents,
 * a client-assigned msgSeqNum counter, and lastFrameNanos. The two aggregates are
 * accumulated here rather than folded from the tape, which only holds the newest
 * TAPE_CAP fills.
 */

import { isFill } from "../protocol/messages";
import type { ClientFrame, ExecFrame, Level, ServerFrame, Side } from "../protocol/messages";

/** Newest-first fill history cap. */
export const TAPE_CAP = 200;

/** Sentinel for "no session-open price yet": no trade has printed this session. */
const SESSION_OPEN_UNSET = -1;

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

export type OrderStatus =
    | "PENDING"
    | "OPEN"
    | "PARTIALLY_FILLED"
    | "FILLED"
    | "CANCELLED"
    | "REJECTED";

const TERMINAL: readonly OrderStatus[] = ["FILLED", "CANCELLED", "REJECTED"];

export function isTerminal(status: OrderStatus): boolean {
    return TERMINAL.includes(status);
}

/** Cancellable rows, used by the P5-4 OpenOrders panel. */
export function isCancellable(status: OrderStatus): boolean {
    return status === "OPEN" || status === "PARTIALLY_FILLED";
}

export interface BookState {
    readonly bestBid: number;
    readonly bestAsk: number;
    readonly bids: readonly Level[];
    readonly asks: readonly Level[];
    readonly timestamp: number;
}

export interface TapeEntry {
    readonly tradeId: number;
    readonly priceCents: number;
    readonly quantity: number;
    readonly aggressorOrderId: number;
    readonly passiveOrderId: number;
    readonly timestamp: number;
    /** True when either side of the trade is one of this client's orders. */
    readonly mine: boolean;
    /**
     * Aggressor side (P7-6), derived client-side where knowable. No EXEC frame
     * carries a side, so this is set only when one of our own orders is in the
     * trade: our side when we are the aggressor, the opposite when we are the
     * passive side (a trade always crosses a buy against a sell). undefined for
     * anonymous prints. That derivable set equals `mine`, so the tag shows on
     * own-trade rows only.
     */
    readonly aggressorSide?: Side;
}

/**
 * A locally originated order. Side and price are captured at SEND time: no EXEC
 * frame carries a side, so they cannot come from the wire. Status and remaining
 * quantity come only from EXEC.
 */
export interface MyOrder {
    readonly clOrdId: number;
    readonly side: Side;
    readonly priceCents: number;
    readonly originalQty: number;
    readonly remainingQty: number;
    readonly status: OrderStatus;
}

export interface AppState {
    readonly connection: ConnectionStatus;
    readonly book: BookState;
    readonly tape: readonly TapeEntry[];
    /** Newest first. Keyed by clOrdId, which the server echoes as EXEC orderId. */
    readonly myOrders: readonly MyOrder[];
    /**
     * Total quantity traded this session. Accumulated per fill EXEC. One onFill per
     * trade, aggressor-only, filledQuantity per-event (P7-0/Q7-2), so summing across
     * fills cannot double count. Held here, never folded from the capped tape.
     */
    readonly sessionVolume: number;
    /**
     * The session's first trade price in cents. Set once by the first fill EXEC and
     * never overwritten; SESSION_OPEN_UNSET until then. Session change is measured
     * against this, never a previous close.
     */
    readonly sessionOpenCents: number;
    /**
     * Client-assigned outbound message counter. Incremented once per SENT frame,
     * NEW and CANCEL alike. NOT the FIX 34= MsgSeqNum (the produced subset carries
     * no tag 34, P7-0/Q7-4) and NOT the P7-2 server per-channel echo seqNum. It is
     * labelled client-assigned wherever shown.
     */
    readonly msgSeqNum: number;
    /**
     * Epoch-nanos timestamp of the most recent frame received from the server, of
     * any type (BOOK, EXEC, or the P7-2 FIX echo). A pure liveness marker for the
     * session header; 0 until the first frame arrives. The epoch domain (P7-1) is
     * what makes wall-clock rendering possible.
     */
    readonly lastFrameNanos: number;
}

export const EMPTY_BOOK: BookState = {
    bestBid: -1,
    bestAsk: -1,
    bids: [],
    asks: [],
    timestamp: 0,
};

export const initialState: AppState = {
    connection: "connecting",
    book: EMPTY_BOOK,
    tape: [],
    myOrders: [],
    sessionVolume: 0,
    sessionOpenCents: SESSION_OPEN_UNSET,
    msgSeqNum: 0,
    lastFrameNanos: 0,
};

export type Action =
    | { readonly type: "CONNECTION"; readonly status: ConnectionStatus }
    | { readonly type: "FRAME"; readonly frame: ServerFrame }
    | { readonly type: "SENT"; readonly frame: ClientFrame };

/**
 * Aggressor side for a fill, at the only fidelity the wire supports (P7-6).
 *
 * No EXEC frame carries a side, so the aggressor's side is knowable only when one
 * of this client's own orders is in the trade: if we are the aggressor it is our
 * order's side; if we are the passive side it is the opposite, since a trade
 * always crosses a buy against a sell. Foreign-vs-foreign trades return undefined.
 * The derivable set is exactly the `mine` set, so a side tag appears precisely on
 * the own-trade rows and nowhere else. Pure and exported for direct unit testing.
 */
export function aggressorSideFor(
    myOrders: readonly MyOrder[],
    aggressorOrderId: number,
    passiveOrderId: number,
): Side | undefined {
    const sideOf = (id: number): Side | undefined =>
        id > 0 ? myOrders.find((o) => o.clOrdId === id)?.side : undefined;

    const aggressor = sideOf(aggressorOrderId);
    if (aggressor !== undefined) return aggressor;

    const passive = sideOf(passiveOrderId);
    if (passive !== undefined) return passive === "BUY" ? "SELL" : "BUY";

    return undefined;
}

/** Status transition for one EXEC applied to one of my orders. */
function nextOrder(order: MyOrder, frame: ExecFrame): MyOrder {
    if (isTerminal(order.status)) return order;

    switch (frame.execType) {
        case "ORDER_ACCEPTED":
            // A trailing ACCEPTED after a partial fill reports the rested remainder.
            // Update the quantity but keep the more informative PARTIALLY_FILLED label.
            return {
                ...order,
                status: order.status === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : "OPEN",
                remainingQty: frame.remainingQuantity,
            };
        case "ORDER_PARTIALLY_FILLED":
            return { ...order, status: "PARTIALLY_FILLED", remainingQty: frame.remainingQuantity };
        case "ORDER_FILLED":
            return { ...order, status: "FILLED", remainingQty: 0 };
        case "ORDER_CANCELLED":
            // Remaining is left at its last known value; the row is terminal either way.
            return { ...order, status: "CANCELLED" };
        case "ORDER_REJECTED":
            return { ...order, status: "REJECTED" };
    }
}

function applyExec(state: AppState, frame: ExecFrame): AppState {
    const knows = (id: number): boolean =>
        id > 0 && state.myOrders.some((o) => o.clOrdId === id);

    let tape = state.tape;
    let sessionVolume = state.sessionVolume;
    let sessionOpenCents = state.sessionOpenCents;

    if (isFill(frame)) {
        const entry: TapeEntry = {
            tradeId: frame.tradeId,
            priceCents: frame.price,
            quantity: frame.filledQuantity,
            aggressorOrderId: frame.aggressorOrderId,
            passiveOrderId: frame.passiveOrderId,
            timestamp: frame.timestamp,
            mine: knows(frame.aggressorOrderId) || knows(frame.passiveOrderId),
            aggressorSide: aggressorSideFor(state.myOrders, frame.aggressorOrderId, frame.passiveOrderId),
        };
        tape = [entry, ...state.tape].slice(0, TAPE_CAP);

        // One onFill per trade, aggressor-only, filledQuantity is the per-event slice
        // (P7-0/Q7-2), so this running sum is the true session quantity with no double
        // count. Accumulated here precisely because the tape is capped.
        sessionVolume = state.sessionVolume + frame.filledQuantity;

        // The first trade sets the session-open reference, once and never again.
        // frame.price is the resting/passive execution price (carried constraint 6).
        // Prices are positive cents, so "<= 0" reads as "still unset".
        if (sessionOpenCents <= 0) {
            sessionOpenCents = frame.price;
        }
    }

    const index = state.myOrders.findIndex((o) => o.clOrdId === frame.orderId);
    let myOrders = state.myOrders;
    if (index !== -1) {
        const current = state.myOrders[index];
        const updated = nextOrder(current, frame);
        if (updated !== current) {
            myOrders = state.myOrders.map((o, i) => (i === index ? updated : o));
        }
    }

    // Every EXEC is a frame received from the server, so it advances the liveness
    // marker even when it changes nothing else (a rejection for an unknown id, a
    // passive fill against a foreign order). tape and myOrders keep their existing
    // references on those no-op paths, so referential-equality checks on those
    // slices still hold; only the top-level object is newly allocated.
    return {
        ...state,
        tape,
        myOrders,
        sessionVolume,
        sessionOpenCents,
        lastFrameNanos: frame.timestamp,
    };
}

function applySent(state: AppState, frame: ClientFrame): AppState {
    // MsgSeqNum counts every outbound frame that actually went on the wire, NEW and
    // CANCEL alike: both are real FIX messages (35=D / 35=F) and each consumes a
    // sequence number. `send` dispatches SENT only on a real socket write, so a
    // no-op send while disconnected consumes nothing.
    const msgSeqNum = state.msgSeqNum + 1;

    // Order-row bookkeeping is NEW-only and unchanged from P5-1: CANCEL records no
    // row (EXEC stays the sole authority on status), and a duplicate clOrdId is
    // ignored. Both paths keep the myOrders reference intact, so the counter can
    // advance without disturbing the panel or its identity guarantees.
    let myOrders = state.myOrders;
    if (frame.type === "NEW" && !state.myOrders.some((o) => o.clOrdId === frame.clOrdId)) {
        const order: MyOrder = {
            clOrdId: frame.clOrdId,
            side: frame.side,
            priceCents: frame.price,
            originalQty: frame.qty,
            remainingQty: frame.qty,
            status: "PENDING",
        };
        myOrders = [order, ...state.myOrders];
    }

    return { ...state, myOrders, msgSeqNum };
}

export function reducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case "CONNECTION": {
            if (action.status === state.connection) return state;
            // A stale ladder is worse than an empty one: any non-open state clears the
            // book. Everything else survives: myOrders and tape (those orders may still
            // be resting server-side), and the session aggregates + liveness marker,
            // which belong to the browser session rather than the socket. A blip must
            // not reset volume/open/msgSeqNum out from under a surviving tape.
            const book = action.status === "open" ? state.book : EMPTY_BOOK;
            return { ...state, connection: action.status, book };
        }
        case "FRAME": {
            const frame = action.frame;
            if (frame.type === "BOOK") {
                // Wholesale replacement. Never merged with anything.
                return {
                    ...state,
                    book: {
                        bestBid: frame.bestBid,
                        bestAsk: frame.bestAsk,
                        bids: frame.bids,
                        asks: frame.asks,
                        timestamp: frame.timestamp,
                    },
                    lastFrameNanos: frame.timestamp,
                };
            }
            if (frame.type === "FIX") {
                // The FIX echo carries no application state (its inspector storage lands
                // in P7-9), but it IS a frame the client received, so it advances the
                // liveness marker and nothing else. This is the one behaviour the P7-2
                // "inert" note anticipated changing.
                return { ...state, lastFrameNanos: frame.timestamp };
            }
            return applyExec(state, frame);
        }
        case "SENT":
            return applySent(state, action.frame);
    }
}