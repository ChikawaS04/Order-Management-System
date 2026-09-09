/**
 * Trade tape (SRS §3.7) — a scrolling, newest-first list of fills.
 *
 * Purely presentational: it renders exactly the reducer's `tape` slice and owns
 * no socket, hook, or state. The reducer is the sole authority on what enters the
 * tape — fills only (ORDER_FILLED / ORDER_PARTIALLY_FILLED), newest-first, capped
 * at TAPE_CAP — so this component never filters, sorts, or caps; it renders what
 * it is given. P5-5 wires `<TradeTape tape={state.tape} />`.
 *
 * Two deliberate omissions, both forced by the wire contract:
 *
 *  - No side column. No EXEC frame carries a side, and the aggressor side is not
 *    on the wire anywhere. Recovering it would mean looking aggressorOrderId up in
 *    myOrders — which only covers fills where this client is the aggressor, and
 *    would couple this presentational component to order state. Side is therefore
 *    not reliably derivable from a TapeEntry and is omitted rather than shown blank.
 *
 *  - No timestamp column. TapeEntry.timestamp is the backend's System.nanoTime()
 *    value (monotonic, arbitrary origin — NOT epoch, despite the wire-contract
 *    label), so it cannot honestly be rendered as a wall-clock time. It is ordering
 *    input upstream in the reducer only.
 *
 * Prices go through format.ts (cents -> dollars, string-based integer math); a `-1`
 * sentinel would render as EMPTY_PRICE, never as a negative dollar amount. In
 * practice a fill always carries the real passive resting price, so this is defensive.
 *
 * Styling is structural only (class-name hooks + data-testid); the terminal theme
 * and the bid-green / ask-red convention are P5-5.
 */

import { centsToDollars } from "../format";
import type { TapeEntry } from "../state/reducer";

interface TradeTapeProps {
    readonly tape: readonly TapeEntry[];
}

export function TradeTape({ tape }: TradeTapeProps) {
    if (tape.length === 0) {
        return (
            <div className="trade-tape">
                <div className="trade-tape__empty" data-testid="tape-empty">
                    No trades yet
                </div>
            </div>
        );
    }

    return (
        <div className="trade-tape">
            {tape.map((entry) => {
                const rowClass = entry.mine
                    ? "trade-tape__row trade-tape__row--mine"
                    : "trade-tape__row";
                return (
                    <div key={entry.tradeId} className={rowClass} data-testid="tape-row">
            <span className="trade-tape__price">
              {centsToDollars(entry.priceCents)}
            </span>
                        <span className="trade-tape__qty">{entry.quantity}</span>
                    </div>
                );
            })}
        </div>
    );
}