/**
 * Header (SRS §3.7). Instrument + top-of-book metrics, derived PURELY from the
 * current BOOK — never from EXEC (BOOK is authoritative book state; EXEC is a
 * notification). ASML is hardcoded: single instrument, no symbol on the wire.
 *
 * The derivation is a pure exported helper (mirrors P5-2 `buildLadder` /
 * P5-4 `validateOrderInput`) so it is unit-tested without a DOM. The `-1`
 * top-of-book sentinel is handled two ways: bestBid/bestAsk go through
 * `centsToDollars`, whose negative -> EMPTY_PRICE rule already absorbs it; mid
 * and spread appear only when BOTH sides are present.
 */

import { centsToDollars, EMPTY_PRICE } from "../format";
import { spreadLabel } from "./DepthLadder";
import type { BookState } from "../state/reducer";

const SYMBOL = "ASML";

export interface HeaderModel {
    readonly bestBid: string;
    readonly bestAsk: string;
    readonly mid: string;
    readonly spread: string;
}

/**
 * Midpoint as a half-cent-safe dollar string, integer math only (no float on the
 * price path). The mid of two cent prices is (bid + ask) / 2, a half-cent
 * whenever the sum is odd. `centsToDollars` renders only whole cents, so the
 * trailing half-cent is appended as "5": bid 15000 + ask 15025 -> "150.125".
 * Guarded — if either top is <= 0 (the -1 sentinel, i.e. no two-sided market)
 * there is no meaningful mid, so EMPTY_PRICE. Truncating to whole cents was
 * rejected: it would misreport a genuine half-cent mid as a whole-cent one, and
 * the frontend derives mid from BOOK directly (it never consumes the backend's
 * whole-cent getMidpoint).
 */
function midpointLabel(bestBid: number, bestAsk: number): string {
    if (!(bestBid > 0 && bestAsk > 0)) return EMPTY_PRICE;
    const sum = bestBid + bestAsk;
    const whole = (sum - (sum % 2)) / 2; // exact integer half of an even value
    const base = centsToDollars(whole);
    return sum % 2 === 0 ? base : `${base}5`;
}

/** Pure, exported: all four header fields from one BOOK slice. */
export function deriveHeader(book: BookState): HeaderModel {
    return {
        bestBid: centsToDollars(book.bestBid),
        bestAsk: centsToDollars(book.bestAsk),
        mid: midpointLabel(book.bestBid, book.bestAsk),
        // Reuse P5-2's guarded spread helper rather than re-deriving the sentinel
        // guard — one source of truth for "spread only when both tops are real".
        spread: spreadLabel(book.bestBid, book.bestAsk),
    };
}

interface HeaderProps {
    readonly book: BookState;
}

export function Header({ book }: HeaderProps) {
    const { bestBid, bestAsk, mid, spread } = deriveHeader(book);

    return (
        <div className="header">
            <div className="header__symbol">
                <span className="header__ticker">{SYMBOL}</span>
                <span className="header__subtitle">Practice OMS</span>
            </div>

            <div className="header__quote">
                <div className="header__metric header__metric--bid">
                    <span className="header__label">Bid</span>
                    <span className="header__value" data-testid="header-bid">{bestBid}</span>
                </div>
                <div className="header__metric header__metric--ask">
                    <span className="header__label">Ask</span>
                    <span className="header__value" data-testid="header-ask">{bestAsk}</span>
                </div>
                <div className="header__metric">
                    <span className="header__label">Mid</span>
                    <span className="header__value" data-testid="header-mid">{mid}</span>
                </div>
                <div className="header__metric">
                    <span className="header__label">Spread</span>
                    <span className="header__value" data-testid="header-spread">{spread}</span>
                </div>
            </div>
        </div>
    );
}