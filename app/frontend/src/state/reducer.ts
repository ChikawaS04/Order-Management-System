/**
 * Pure application state. No React, no socket, no side effects.
 *
 * Two rules dominate, both inherited from Phase 4:
 *
 *  1. BOOK is authoritative book state and replaces bids/asks/tops wholesale.
 *     EXEC never touches the book. The two streams are independent Disruptor
 *     consumers with separate sequence counters and interleave unpredictably,
 *     so book state can never be inferred from EXEC arrival order.
 *
 *  2. A passive resting order that is hit receives NO EXEC of its own — the
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
 */

import { isFill } from "../protocol/messages";
import type { ClientFrame, ExecFrame, Level, ServerFrame, Side } from "../protocol/messages";

/** Newest-first fill history cap. */
export const TAPE_CAP = 200;

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

/** Cancellable rows — used by the P5-4 OpenOrders panel. */
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
}

/**
 * A locally originated order. Side and price are captured at SEND time — no EXEC
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
};

export type Action =
    | { readonly type: "CONNECTION"; readonly status: ConnectionStatus }
    | { readonly type: "FRAME"; readonly frame: ServerFrame }
    | { readonly type: "SENT"; readonly frame: ClientFrame };

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
    if (isFill(frame)) {
        const entry: TapeEntry = {
            tradeId: frame.tradeId,
            priceCents: frame.price,
            quantity: frame.filledQuantity,
            aggressorOrderId: frame.aggressorOrderId,
            passiveOrderId: frame.passiveOrderId,
            timestamp: frame.timestamp,
            mine: knows(frame.aggressorOrderId) || knows(frame.passiveOrderId),
        };
        tape = [entry, ...state.tape].slice(0, TAPE_CAP);
    }

    // EXEC orderId is the aggressor on fills, the cancelled/rejected order's id
    // otherwise. An id we don't own means this report belongs to another client
    // (or is a fill against our resting order, which carries no per-order update).
    const index = state.myOrders.findIndex((o) => o.clOrdId === frame.orderId);
    let myOrders = state.myOrders;
    if (index !== -1) {
        const current = state.myOrders[index];
        const updated = nextOrder(current, frame);
        if (updated !== current) {
            myOrders = state.myOrders.map((o, i) => (i === index ? updated : o));
        }
    }

    if (tape === state.tape && myOrders === state.myOrders) return state;
    return { ...state, tape, myOrders };
}

function applySent(state: AppState, frame: ClientFrame): AppState {
    // CANCEL deliberately records nothing: EXEC stays the sole authority on status,
    // so a row remains OPEN and cancellable until ORDER_CANCELLED arrives.
    if (frame.type !== "NEW") return state;
    if (state.myOrders.some((o) => o.clOrdId === frame.clOrdId)) return state;

    const order: MyOrder = {
        clOrdId: frame.clOrdId,
        side: frame.side,
        priceCents: frame.price,
        originalQty: frame.qty,
        remainingQty: frame.qty,
        status: "PENDING",
    };
    return { ...state, myOrders: [order, ...state.myOrders] };
}

export function reducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case "CONNECTION": {
            if (action.status === state.connection) return state;
            // A stale ladder is worse than an empty one: any non-open state clears the
            // book. myOrders and the tape survive — those orders may still be resting
            // on the server, and the user's own record shouldn't vanish on a blip.
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
                };
            }
            return applyExec(state, frame);
        }
        case "SENT":
            return applySent(state, action.frame);
    }
}