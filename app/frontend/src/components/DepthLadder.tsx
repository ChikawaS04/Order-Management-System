/**
 * Presentational depth ladder (SRS §3.7 depth chart).
 *
 * Pure edge: takes the authoritative BOOK slice as a single prop and owns no
 * socket, hook, or state. It renders only from `book` — never from EXEC, and
 * never from anything derived from EXEC ordering (the load-bearing Phase-4
 * constraint).
 *
 * Layout: asks on top in descending price (best ask sits at the bottom, nearest
 * the mid divider), bids below in descending price (best bid at the top, nearest
 * the divider). Each row carries a CSS depth bar whose width is proportional to
 * CUMULATIVE quantity outward from the mid.
 *
 * Bar scaling: SHARED max across both sides (both sides scale to the larger
 * side's total cumulative depth). This is the only scaling that renders bid/ask
 * imbalance truthfully — independent per-side scaling would paint a thin side
 * and a heavy side identically. Documented in the P5-2 as-built note.
 *
 * Cents in, dollars only at this render edge via format.ts. No float price math.
 * `-1` sentinels never surface as a price: row prices are always real levels
 * (server trims BOOK to the valid prefix), and the spread is guarded before the
 * subtraction so a `-1` top can't produce a bogus positive number.
 */

import { centsToDollars, EMPTY_PRICE } from "../format";
import type { BookState } from "../state/reducer";
import type { Level } from "../protocol/messages";

/** One rendered ladder row: real price, its quantity, cumulative depth, bar width. */
export interface LadderRow {
    readonly priceCents: number;
    readonly qty: number;
    readonly cumQty: number;
    /** 0..100, proportional to cumulative depth against the shared max. */
    readonly widthPct: number;
}

/** Both sides in display order (asks highest-first, bids highest-first). */
export interface LadderModel {
    readonly asks: readonly LadderRow[];
    readonly bids: readonly LadderRow[];
}

interface CumLevel {
    readonly priceCents: number;
    readonly qty: number;
    readonly cumQty: number;
}

/** Running cumulative quantity, best-first (outward from the mid). */
function cumulate(levels: readonly Level[]): CumLevel[] {
    const rows: CumLevel[] = [];
    let running = 0;
    for (const level of levels) {
        running += level[1];
        rows.push({ priceCents: level[0], qty: level[1], cumQty: running });
    }
    return rows;
}

/**
 * Pure depth-bar model. Unit-tested directly, separately from the component.
 *
 * `bids` arrive highest-first, `asks` lowest-first (both best-first), already
 * trimmed to <=10 real levels server-side — no client-side cap. Cumulative depth
 * is monotonic, so each side's total is its last element; the shared max is the
 * larger of the two, guarded so an empty book yields zero widths (never NaN).
 */
export function buildLadder(
    bids: readonly Level[],
    asks: readonly Level[],
): LadderModel {
    const bidCum = cumulate(bids);
    const askCum = cumulate(asks);

    const maxBid = bidCum.length > 0 ? bidCum[bidCum.length - 1].cumQty : 0;
    const maxAsk = askCum.length > 0 ? askCum[askCum.length - 1].cumQty : 0;
    const sharedMax = Math.max(maxBid, maxAsk);

    const withWidth = (r: CumLevel): LadderRow => ({
        priceCents: r.priceCents,
        qty: r.qty,
        cumQty: r.cumQty,
        widthPct: sharedMax > 0 ? (r.cumQty / sharedMax) * 100 : 0,
    });

    // asks: cumulate is lowest-first; reverse for display so the best ask lands
    // at the bottom, nearest the mid divider.
    const askRows = askCum.map(withWidth).reverse();
    // bids: cumulate is highest-first = display order already (best bid on top).
    const bidRows = bidCum.map(withWidth);

    return { asks: askRows, bids: bidRows };
}

/**
 * Spread for the mid divider. Guarded: computed only when BOTH tops are real.
 * A `-1` sentinel on either side must not reach the subtraction — e.g.
 * bestAsk 15000 with bestBid -1 would yield 15001 → "150.01", a bogus spread
 * that centsToDollars cannot catch because it is positive.
 */
export function spreadLabel(bestBid: number, bestAsk: number): string {
    if (bestBid > 0 && bestAsk > 0) {
        return centsToDollars(bestAsk - bestBid);
    }
    return EMPTY_PRICE;
}

function renderRow(row: LadderRow, side: "ask" | "bid") {
    return (
        <div
            key={row.priceCents}
            className={`depth-ladder__row depth-ladder__row--${side}`}
            data-testid={`${side}-row`}
        >
            <div
                className="depth-ladder__bar"
                style={{ width: `${row.widthPct}%` }}
                aria-hidden="true"
            />
            <span className="depth-ladder__price">{centsToDollars(row.priceCents)}</span>
            <span className="depth-ladder__qty">{row.qty}</span>
        </div>
    );
}

interface DepthLadderProps {
    readonly book: BookState;
}

export function DepthLadder({ book }: DepthLadderProps) {
    const { asks, bids } = buildLadder(book.bids, book.asks);
    const spread = spreadLabel(book.bestBid, book.bestAsk);

    return (
        <div className="depth-ladder">
            <div className="depth-ladder__asks">
                {asks.map((row) => renderRow(row, "ask"))}
            </div>
            <div className="depth-ladder__divider">
                <span className="depth-ladder__spread-label">Spread</span>
                <span className="depth-ladder__spread-value" data-testid="spread-value">
          {spread}
        </span>
            </div>
            <div className="depth-ladder__bids">
                {bids.map((row) => renderRow(row, "bid"))}
            </div>
        </div>
    );
}