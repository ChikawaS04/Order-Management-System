/**
 * The wire contract, and the ONLY place raw JSON becomes typed.
 *
 * Shapes are transcribed from the Phase-4 as-built `WebSocketPublisher`
 * (serializeExecution / serializeSnapshot) and `WebSocketFrameHandler`, not from
 * a guide summary. Every price is integer cents in both directions; dollars
 * exist only at the render/parse edge (format.ts).
 *
 * Server -> client: BOOK (authoritative book state) | EXEC (notification).
 * Client -> server: NEW | CANCEL.
 */

/** Single instrument; the server emits no symbol field, and expects this one inbound. */
export const SYMBOL = "ASML" as const;

export type Side = "BUY" | "SELL";

/** Full Java enum names, via ExecutionEventType.name(). */
export type ExecType =
    | "ORDER_ACCEPTED"
    | "ORDER_FILLED"
    | "ORDER_PARTIALLY_FILLED"
    | "ORDER_CANCELLED"
    | "ORDER_REJECTED";

/** One depth level: [priceCents, aggregatedQty]. */
export type Level = readonly [price: number, qty: number];

/**
 * Authoritative book state. Already trimmed server-side to the valid prefix
 * (P4-6 honours the count-authoritative contract), so arrays hold only real
 * levels. `-1` tops and empty arrays on an empty side. bids highest-first,
 * asks lowest-first.
 */
export interface BookFrame {
    readonly type: "BOOK";
    readonly bestBid: number;
    readonly bestAsk: number;
    readonly bids: readonly Level[];
    readonly asks: readonly Level[];
    readonly timestamp: number;
}

/**
 * Execution report. All nine fields are always present; `-1` marks NA — the
 * server emits a fixed schema and never omits keys.
 *
 * On ORDER_FILLED / ORDER_PARTIALLY_FILLED, `orderId === aggressorOrderId` and
 * `remainingQuantity` is the AGGRESSOR's remaining size. A passive resting order
 * that is hit receives no EXEC of its own (confirmed against MatchingEngine's
 * match loops) — see reducer.ts for how that gap is modelled.
 */
export interface ExecFrame {
    readonly type: "EXEC";
    readonly execType: ExecType;
    readonly orderId: number;
    readonly tradeId: number;
    readonly price: number;
    readonly filledQuantity: number;
    readonly remainingQuantity: number;
    readonly aggressorOrderId: number;
    readonly passiveOrderId: number;
    readonly timestamp: number;
}

export type ServerFrame = BookFrame | ExecFrame;

export interface NewOrderFrame {
    readonly type: "NEW";
    readonly clOrdId: number;
    readonly side: Side;
    /** Integer cents. JsonToFix.formatPrice does cents -> FIX decimal server-side. */
    readonly price: number;
    readonly qty: number;
    readonly symbol: typeof SYMBOL;
}

export interface CancelOrderFrame {
    readonly type: "CANCEL";
    readonly clOrdId: number;
    readonly origClOrdId: number;
}

export type ClientFrame = NewOrderFrame | CancelOrderFrame;

/** The NA sentinel used by every optional numeric field on the wire. */
export const NA = -1;

const EXEC_TYPES: readonly string[] = [
    "ORDER_ACCEPTED",
    "ORDER_FILLED",
    "ORDER_PARTIALLY_FILLED",
    "ORDER_CANCELLED",
    "ORDER_REJECTED",
];

export function isExecType(value: unknown): value is ExecType {
    return typeof value === "string" && EXEC_TYPES.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Integer-or-null. Callers must compare `=== null` — 0 is a legitimate value. */
function int(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function levels(value: unknown): Level[] | null {
    if (!Array.isArray(value)) return null;
    const out: Level[] = [];
    for (const raw of value) {
        if (!Array.isArray(raw) || raw.length !== 2) return null;
        const price = int(raw[0]);
        const qty = int(raw[1]);
        if (price === null || qty === null) return null;
        out.push([price, qty]);
    }
    return out;
}

/**
 * The single narrowing point: raw socket text -> typed frame, or null.
 *
 * Returns a freshly constructed object rather than the parsed one, so an
 * accepted frame provably matches its declared type and no unvalidated extra
 * field can ride along into state.
 */
export function parseServerFrame(raw: string): ServerFrame | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isRecord(parsed)) return null;

    switch (parsed.type) {
        case "BOOK": {
            const bestBid = int(parsed.bestBid);
            const bestAsk = int(parsed.bestAsk);
            const timestamp = int(parsed.timestamp);
            const bids = levels(parsed.bids);
            const asks = levels(parsed.asks);
            if (bestBid === null || bestAsk === null || timestamp === null) return null;
            if (bids === null || asks === null) return null;
            return { type: "BOOK", bestBid, bestAsk, bids, asks, timestamp };
        }
        case "EXEC": {
            const execType = parsed.execType;
            if (!isExecType(execType)) return null;
            const orderId = int(parsed.orderId);
            const tradeId = int(parsed.tradeId);
            const price = int(parsed.price);
            const filledQuantity = int(parsed.filledQuantity);
            const remainingQuantity = int(parsed.remainingQuantity);
            const aggressorOrderId = int(parsed.aggressorOrderId);
            const passiveOrderId = int(parsed.passiveOrderId);
            const timestamp = int(parsed.timestamp);
            if (
                orderId === null ||
                tradeId === null ||
                price === null ||
                filledQuantity === null ||
                remainingQuantity === null ||
                aggressorOrderId === null ||
                passiveOrderId === null ||
                timestamp === null
            ) {
                return null;
            }
            return {
                type: "EXEC",
                execType,
                orderId,
                tradeId,
                price,
                filledQuantity,
                remainingQuantity,
                aggressorOrderId,
                passiveOrderId,
                timestamp,
            };
        }
        default:
            return null;
    }
}

/** True for the two EXEC types that represent an actual trade. */
export function isFill(frame: ExecFrame): boolean {
    return frame.execType === "ORDER_FILLED" || frame.execType === "ORDER_PARTIALLY_FILLED";
}