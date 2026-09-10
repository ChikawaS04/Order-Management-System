/**
 * Manual order entry ticket (SRS §3.7), refined in P7-7. Presentational and
 * callback-driven: it owns only transient form state (side, the raw price/qty
 * strings, an error) and emits resolved, cents-internal intent via `onSubmit`.
 * It never generates a clOrdId, builds a wire frame, or touches the socket; that
 * lives in one place, the App wiring over the single useOrderBook instance, so
 * clOrdId is generated in exactly one place and never derived from server data.
 *
 * P7-7 adds ticket affordances WITHOUT changing what it sends (the same NEW
 * frame): bid / mid / ask reference chips, one-cent tick nudges, quantity
 * presets, and an explicit Tag 11 clOrdId field showing the client-assigned id
 * the next NEW will use. Every affordance resolves to integer cents through
 * format.ts; no float touches the price path.
 *
 * Controlled-price seam. The chips and nudges write the SAME uncontrolled
 * `priceInput` the user types, so there is one source of truth and the P5-4
 * validation is byte-identical. The external seam for the P7-5 depth curve
 * (wired in P7-10) is the imperative `setPrice(priceCents)` handle, which takes
 * exactly the shape `onPriceSelect` emits. The ref exposes only a price setter,
 * not state ownership, so the P5-6 discipline holds.
 */

import { forwardRef, useImperativeHandle, useState } from "react";

import { centsToDollars, dollarsToCents, EMPTY_PRICE } from "../format";
import type { Side } from "../protocol/messages";

export type ValidationResult =
    | { readonly ok: true; readonly priceCents: number; readonly qty: number }
    | { readonly ok: false; readonly reason: string };

const PRICE_REASON = "Price must be greater than 0 with at most 2 decimals";
const QTY_REASON = "Quantity must be a positive whole number";

/**
 * Pure input validation, exported for direct unit testing (mirrors P5-2's
 * `buildLadder` split). Price delegates to `dollarsToCents`, which mirrors the
 * backend `parsePrice` policy exactly; quantity must be a positive whole number
 * (no decimals, no sign, no exponent).
 */
export function validateOrderInput(priceInput: string, qtyInput: string): ValidationResult {
    const priceCents = dollarsToCents(priceInput);
    if (priceCents === null) {
        return { ok: false, reason: PRICE_REASON };
    }

    const qtyTrimmed = qtyInput.trim();
    if (!/^\d+$/.test(qtyTrimmed)) {
        return { ok: false, reason: QTY_REASON };
    }
    const qty = Number(qtyTrimmed);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
        return { ok: false, reason: QTY_REASON };
    }

    return { ok: true, priceCents, qty };
}

/** One cent. The integer-cents primitive is the unit end to end. */
export const TICK_CENTS = 1;

/** Round-lot quantity presets. */
export const QTY_PRESETS = [10, 50, 100, 500] as const;

/**
 * The mid resolved to a valid whole-cent limit, integer math only, for the mid
 * chip. Returns null when the book is one-sided (chip disabled). The mid of two
 * cent prices is (bid + ask) / 2, a half-cent when the sum is odd; the only tie
 * case is that exact half-cent, and it rounds UP toward the higher cent (toward
 * the ask by half a cent), stated so the chip can never populate a 3-decimal
 * price. This is deliberately NOT format.ts's `midpointCents`, which stays the
 * render-only half-cent float; the price path uses integers only.
 */
export function midChipCents(bestBid: number, bestAsk: number): number | null {
    if (bestBid <= 0 || bestAsk <= 0) return null;
    const sum = bestBid + bestAsk;
    return (sum + (sum % 2)) / 2;
}

/**
 * Adjust a cent price by `steps` ticks, clamped so it can never fall below one
 * tick. Integer in, integer out, always positive: a nudge can never produce a
 * non-integer or non-positive price.
 */
export function nudgeCents(cents: number, steps: number, tick: number = TICK_CENTS): number {
    return Math.max(tick, cents + steps * tick);
}

/**
 * Apply a quantity preset without clobbering a typed value: fill only when the
 * field is empty, so a stray preset click never wipes a size the trader entered.
 */
export function applyPreset(currentQtyInput: string, preset: number): string {
    return currentQtyInput.trim() === "" ? String(preset) : currentQtyInput;
}

/** Imperative seam for the P7-5 depth curve (wired in P7-10): set the price in cents. */
export interface OrderEntryHandle {
    setPrice: (priceCents: number) => void;
}

export interface OrderEntryProps {
    readonly onSubmit: (side: Side, priceCents: number, qty: number) => void;
    /** When true (e.g. socket not open), the whole ticket is inert and visibly disabled. */
    readonly disabled?: boolean;
    /** Live best bid in cents for the Bid chip; -1 (default) disables it. */
    readonly bestBidCents?: number;
    /** Live best ask in cents for the Ask chip; -1 (default) disables it. */
    readonly bestAskCents?: number;
    /** Display-only: the client-assigned id the next NEW will use (nextClOrdId.peek()). */
    readonly clOrdIdPreview?: number;
}

export const OrderEntry = forwardRef<OrderEntryHandle, OrderEntryProps>(function OrderEntry(
    { onSubmit, disabled = false, bestBidCents = -1, bestAskCents = -1, clOrdIdPreview },
    ref,
) {
    const [side, setSide] = useState<Side>("BUY");
    const [priceInput, setPriceInput] = useState("");
    const [qtyInput, setQtyInput] = useState("");
    const [error, setError] = useState<string | null>(null);

    // The one seam the chips, the nudges, and (via the ref) the curve all feed: it
    // writes the same priceInput the user types, so single-source-of-truth holds.
    const applyPrice = (priceCents: number): void => {
        setPriceInput(centsToDollars(priceCents));
        setError(null);
    };

    useImperativeHandle(ref, () => ({ setPrice: applyPrice }), []);

    const submit = (): void => {
        if (disabled) return;
        const result = validateOrderInput(priceInput, qtyInput);
        if (!result.ok) {
            setError(result.reason);
            return;
        }
        setError(null);
        onSubmit(side, result.priceCents, result.qty);
        // Clear price + qty for the next order; keep the side for repeat fires.
        setPriceInput("");
        setQtyInput("");
    };

    const nudge = (steps: number): void => {
        if (disabled) return;
        const current = dollarsToCents(priceInput);
        if (current === null) return; // empty or invalid: no base to nudge, so no-op
        applyPrice(nudgeCents(current, steps));
    };

    const preset = (value: number): void => {
        if (disabled) return;
        setQtyInput((q) => applyPreset(q, value));
    };

    const midCents = midChipCents(bestBidCents, bestAskCents);

    return (
        <div className="order-entry">
            <div className="order-entry__side" role="group" aria-label="Side">
                <button
                    type="button"
                    className={`order-entry__side-btn${side === "BUY" ? " order-entry__side-btn--active" : ""}`}
                    aria-pressed={side === "BUY"}
                    data-testid="side-buy"
                    disabled={disabled}
                    onClick={() => setSide("BUY")}
                >
                    BUY
                </button>
                <button
                    type="button"
                    className={`order-entry__side-btn${side === "SELL" ? " order-entry__side-btn--active" : ""}`}
                    aria-pressed={side === "SELL"}
                    data-testid="side-sell"
                    disabled={disabled}
                    onClick={() => setSide("SELL")}
                >
                    SELL
                </button>
            </div>

            <div className="order-entry__chips" role="group" aria-label="Reference prices">
                <button
                    type="button"
                    className="order-entry__chip order-entry__chip--bid"
                    data-testid="chip-bid"
                    disabled={disabled || bestBidCents <= 0}
                    onClick={() => applyPrice(bestBidCents)}
                >
                    <span className="order-entry__chip-label">Bid</span>
                    <span className="order-entry__chip-value">
            {bestBidCents > 0 ? centsToDollars(bestBidCents) : EMPTY_PRICE}
          </span>
                </button>
                <button
                    type="button"
                    className="order-entry__chip order-entry__chip--mid"
                    data-testid="chip-mid"
                    disabled={disabled || midCents === null}
                    onClick={() => {
                        if (midCents !== null) applyPrice(midCents);
                    }}
                >
                    <span className="order-entry__chip-label">Mid</span>
                    <span className="order-entry__chip-value">
            {midCents !== null ? centsToDollars(midCents) : EMPTY_PRICE}
          </span>
                </button>
                <button
                    type="button"
                    className="order-entry__chip order-entry__chip--ask"
                    data-testid="chip-ask"
                    disabled={disabled || bestAskCents <= 0}
                    onClick={() => applyPrice(bestAskCents)}
                >
                    <span className="order-entry__chip-label">Ask</span>
                    <span className="order-entry__chip-value">
            {bestAskCents > 0 ? centsToDollars(bestAskCents) : EMPTY_PRICE}
          </span>
                </button>
            </div>

            <div className="order-entry__field">
                <div className="order-entry__field-head">
                    <span className="order-entry__label">Price</span>
                    <span className="order-entry__tag">Tag 44</span>
                </div>
                <div className="order-entry__price-row">
                    <button
                        type="button"
                        className="order-entry__nudge"
                        data-testid="nudge-down"
                        aria-label="Decrease price one tick"
                        disabled={disabled}
                        onClick={() => nudge(-1)}
                    >
                        −
                    </button>
                    <input
                        className="order-entry__input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={priceInput}
                        data-testid="price-input"
                        aria-label="Price"
                        disabled={disabled}
                        onChange={(e) => setPriceInput(e.target.value)}
                    />
                    <button
                        type="button"
                        className="order-entry__nudge"
                        data-testid="nudge-up"
                        aria-label="Increase price one tick"
                        disabled={disabled}
                        onClick={() => nudge(1)}
                    >
                        +
                    </button>
                </div>
                <span className="order-entry__primitive">Primitive: 18530L cents</span>
            </div>

            <div className="order-entry__field">
                <div className="order-entry__field-head">
                    <span className="order-entry__label">Qty</span>
                    <span className="order-entry__tag">Tag 38</span>
                </div>
                <input
                    className="order-entry__input"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={qtyInput}
                    data-testid="qty-input"
                    aria-label="Quantity"
                    disabled={disabled}
                    onChange={(e) => setQtyInput(e.target.value)}
                />
                <div className="order-entry__presets" role="group" aria-label="Quantity presets">
                    {QTY_PRESETS.map((p) => (
                        <button
                            key={p}
                            type="button"
                            className="order-entry__preset"
                            data-testid={`qty-preset-${p}`}
                            disabled={disabled}
                            onClick={() => preset(p)}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            <div className="order-entry__clordid" data-testid="order-entry-clordid">
                <span className="order-entry__label">ClOrdId</span>
                <span className="order-entry__tag">Tag 11</span>
                <span
                    className="order-entry__clordid-value"
                    data-testid="order-entry-clordid-value"
                >
          {clOrdIdPreview !== undefined ? clOrdIdPreview : EMPTY_PRICE}
        </span>
                <span className="order-entry__clordid-note">auto, client-assigned</span>
            </div>

            <button
                type="button"
                className="order-entry__submit"
                data-testid="order-submit"
                disabled={disabled}
                onClick={submit}
            >
                Submit {side}
            </button>

            {error !== null ? (
                <div className="order-entry__error" role="alert" data-testid="order-entry-error">
                    {error}
                </div>
            ) : null}
        </div>
    );
});

OrderEntry.displayName = "OrderEntry";