/**
 * Presentational depth ladder (SRS §3.7 depth chart), refined in P7-4.
 *
 * Pure edge: it renders only from the authoritative BOOK slice plus one derived
 * scalar (the last trade price, for the divider). It owns no socket or hook and
 * never reads EXEC or anything derived from EXEC ordering (the load-bearing
 * Phase-4 constraint). The one piece of local state is the visible-depth
 * selector, which re-slices the book already in hand with no refetch.
 *
 * Layout, top to bottom: a depth selector, a Price / Size / Total caption, the
 * ask side (highest price on top, best ask nearest the mid divider), a spread /
 * mid / last strip, then the bid side (best bid on top, nearest the divider).
 * Each row has three columns plus a CSS depth bar whose width is proportional to
 * CUMULATIVE quantity outward from the touch.
 *
 * Bar scaling: SHARED max across both visible sides, so bid/ask imbalance renders
 * truthfully rather than painting a thin side and a heavy side alike (the P5-2
 * decision, now taken over the visible window so it rescales when the depth
 * selector changes). buildLadder exposes the raw 0..1 shadeFraction and a 0..100
 * widthPct derived from it; the component sizes the bar from widthPct.
 *
 * Cents in, dollars only at this render edge via format.ts. No float price math.
 * midpointLabel is imported from format.ts so this divider and the P7-3 header
 * share one half-cent-safe definition. cumulate moved to depth.ts in P7-5 so the
 * ladder and the depth curve share one cumulation. Sentinels never surface: rows
 * are always real levels (BOOK is trimmed to the valid prefix server-side and
 * replaced wholesale), and spread, mid, and last are each guarded before formatting.
 */

import { useState } from "react";

import { cumulate, type CumLevel } from "../depth";
import { centsToDollars, EMPTY_PRICE, midpointLabel } from "../format";
import type { BookState } from "../state/reducer";
import type { Level } from "../protocol/messages";

/** Selectable visible depth per side. Server trims BOOK to a <=10 prefix (P4-6),
 *  so 14 shows at most what the server sends; it widens only if that prefix grows. */
const DEPTH_OPTIONS = [8, 10, 14] as const;
const DEFAULT_DEPTH = 10;

/** One rendered ladder row: real price, its quantity, cumulative depth, shading. */
export interface LadderRow {
    readonly priceCents: number;
    readonly qty: number;
    readonly cumQty: number;
    /** Cumulative depth as a fraction of the visible window's largest cumulative value, 0..1. */
    readonly shadeFraction: number;
    /** shadeFraction rendered as a 0..100 width for the inline depth bar. */
    readonly widthPct: number;
}

/** Both sides in display order (asks highest-first, bids highest-first). */
export interface LadderModel {
    readonly asks: readonly LadderRow[];
    readonly bids: readonly LadderRow[];
}

/**
 * Pure depth-bar model. Unit-tested directly, separately from the component.
 *
 * `bids` arrive highest-first, `asks` lowest-first (both best-first). Each side is
 * first sliced to `depth` levels (the visible window; omitting `depth` means no
 * cap, the pre-P7-4 behaviour, which keeps the BOOK's own server-trimmed prefix),
 * then cumulated from the touch outward. Cumulative depth is monotonic, so each
 * visible side's total is its last element; the shared max is the larger of the
 * two, guarded so an empty window yields zero widths (never NaN). Every row
 * carries the raw shadeFraction in [0,1] and widthPct = shadeFraction * 100.
 */
export function buildLadder(
    bids: readonly Level[],
    asks: readonly Level[],
    depth?: number,
): LadderModel {
    const limit = depth ?? Number.POSITIVE_INFINITY;
    const bidCum = cumulate(bids.slice(0, limit));
    const askCum = cumulate(asks.slice(0, limit));

    const maxBid = bidCum.length > 0 ? bidCum[bidCum.length - 1].cumQty : 0;
    const maxAsk = askCum.length > 0 ? askCum[askCum.length - 1].cumQty : 0;
    const sharedMax = Math.max(maxBid, maxAsk);

    const withWidth = (r: CumLevel): LadderRow => {
        const shadeFraction = sharedMax > 0 ? r.cumQty / sharedMax : 0;
        return {
            priceCents: r.priceCents,
            qty: r.qty,
            cumQty: r.cumQty,
            shadeFraction,
            widthPct: shadeFraction * 100,
        };
    };

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
            <span className="depth-ladder__cum">{row.cumQty}</span>
        </div>
    );
}

interface DepthLadderProps {
    readonly book: BookState;
    /**
     * Last trade price in cents for the divider's Last cell. It is the newest tape
     * print (App derives it as `tape[0].priceCents`), not part of the BOOK slice,
     * so `buildLadder` stays book-only and pure. Defaults to the -1 sentinel, which
     * renders blank, so the ladder is still valid before the first trade.
     */
    readonly lastCents?: number;
}

export function DepthLadder({ book, lastCents = -1 }: DepthLadderProps) {
    const [depth, setDepth] = useState<number>(DEFAULT_DEPTH);

    const { asks, bids } = buildLadder(book.bids, book.asks, depth);
    const spread = spreadLabel(book.bestBid, book.bestAsk);
    const mid = midpointLabel(book.bestBid, book.bestAsk);
    const last = lastCents > 0 ? centsToDollars(lastCents) : EMPTY_PRICE;

    return (
        <div className="depth-ladder">
            <div className="depth-ladder__controls">
                <label className="depth-ladder__depth-label" htmlFor="depth-select">
                    Depth
                </label>
                <select
                    id="depth-select"
                    className="depth-ladder__depth"
                    data-testid="depth-select"
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                >
                    {DEPTH_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                            {n}
                        </option>
                    ))}
                </select>
            </div>

            <div className="depth-ladder__head" aria-hidden="true">
                <span className="depth-ladder__head-price">Price</span>
                <span className="depth-ladder__head-qty">Size</span>
                <span className="depth-ladder__head-cum">Total</span>
            </div>

            <div className="depth-ladder__asks">
                {asks.map((row) => renderRow(row, "ask"))}
            </div>

            <div className="depth-ladder__divider">
        <span className="depth-ladder__divider-cell">
          <span className="depth-ladder__divider-label">Spread</span>
          <span className="depth-ladder__divider-value" data-testid="spread-value">
            {spread}
          </span>
        </span>
                <span className="depth-ladder__divider-cell">
          <span className="depth-ladder__divider-label">Mid</span>
          <span className="depth-ladder__divider-value" data-testid="mid-value">
            {mid}
          </span>
        </span>
                <span className="depth-ladder__divider-cell">
          <span className="depth-ladder__divider-label">Last</span>
          <span className="depth-ladder__divider-value" data-testid="last-value">
            {last}
          </span>
        </span>
            </div>

            <div className="depth-ladder__bids">
                {bids.map((row) => renderRow(row, "bid"))}
            </div>
        </div>
    );
}