/**
 * Outbound frame construction and ClOrdID generation.
 *
 * ClOrdID must be numeric (Phase 3 parses tag 11 directly to a Java long) and
 * is client-owned. The counter is seeded at Date.now() so a page reload cannot
 * collide with orders still resting on the server from before the refresh, and
 * every outbound message — cancels included — consumes an id.
 */

import { SYMBOL } from "./messages";
import type { CancelOrderFrame, ClientFrame, NewOrderFrame, Side } from "./messages";

function requirePositiveInt(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer, got ${value}`);
    }
}

/**
 * Builds an independent monotonic generator. The exported `nextClOrdId` is the
 * app-wide instance; tests build their own with a fixed seed for determinism.
 */
export function createClOrdIdGenerator(seed: number = Date.now()): () => number {
    requirePositiveInt(seed, "clOrdId seed");
    let next = seed;
    return () => {
        if (!Number.isSafeInteger(next)) {
            throw new RangeError("clOrdId exhausted the safe-integer range");
        }
        return next++;
    };
}

/** App-wide ClOrdID source. Generated in exactly one place; never derived from server data. */
export const nextClOrdId: () => number = createClOrdIdGenerator();

/** `price` is integer cents — the server converts to FIX decimal dollars. */
export function newOrderFrame(
    clOrdId: number,
    side: Side,
    priceCents: number,
    qty: number,
): NewOrderFrame {
    requirePositiveInt(clOrdId, "clOrdId");
    requirePositiveInt(priceCents, "priceCents");
    requirePositiveInt(qty, "qty");
    return { type: "NEW", clOrdId, side, price: priceCents, qty, symbol: SYMBOL };
}

/**
 * `origClOrdId` is the resting order being cancelled; the request itself takes a
 * fresh `clOrdId`. The resulting ORDER_CANCELLED echoes `origClOrdId` as its
 * `orderId`, never the request's own id.
 */
export function cancelOrderFrame(clOrdId: number, origClOrdId: number): CancelOrderFrame {
    requirePositiveInt(clOrdId, "clOrdId");
    requirePositiveInt(origClOrdId, "origClOrdId");
    return { type: "CANCEL", clOrdId, origClOrdId };
}

export function serializeClientFrame(frame: ClientFrame): string {
    return JSON.stringify(frame);
}