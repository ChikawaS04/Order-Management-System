/**
 * Manual order entry (SRS §3.7). Presentational and callback-driven: it owns
 * only the transient form state (side + raw input strings) and emits resolved,
 * cents-internal intent via `onSubmit`. It never generates a clOrdId, builds a
 * wire frame, or touches the socket — that lives in one place (the P5-5 App
 * wiring, over the single useOrderBook instance), so clOrdID is generated in
 * exactly one place and never derived from server data.
 *
 * Dollars live only inside this component; conversion to integer cents happens
 * at its edge via `dollarsToCents`, so cents is the unit that crosses the prop
 * boundary. Input is validated locally before it can be submitted, because the
 * backend gives no reject feedback for malformed orders (decision 6) — a bad
 * order would otherwise vanish silently.
 *
 * `disabled` (added P5-5) gates the whole form when the socket isn't open. It
 * pairs with the connection badge: `send` already no-ops while disconnected, so
 * this is UX, not a correctness guard — an order can never be silently accepted
 * while down.
 */

import { useState } from "react";

import { dollarsToCents } from "../format";
import type { Side } from "../protocol/messages";

export type ValidationResult =
    | { readonly ok: true; readonly priceCents: number; readonly qty: number }
    | { readonly ok: false; readonly reason: string };

const PRICE_REASON = "Price must be greater than 0 with at most 2 decimals";
const QTY_REASON = "Quantity must be a positive whole number";

/**
 * Pure input validation, exported for direct unit testing (mirrors P5-2's
 * `buildLadder` split — the only real logic in this component lives here and is
 * tested without a DOM). Price delegates to `dollarsToCents`, which already
 * mirrors the backend `parsePrice` policy exactly; quantity must be a positive
 * whole number (no decimals, no sign, no exponent).
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

export interface OrderEntryProps {
    readonly onSubmit: (side: Side, priceCents: number, qty: number) => void;
    /** When true (e.g. socket not open), the form is inert and visibly disabled. */
    readonly disabled?: boolean;
}

export function OrderEntry({ onSubmit, disabled = false }: OrderEntryProps) {
    const [side, setSide] = useState<Side>("BUY");
    const [priceInput, setPriceInput] = useState("");
    const [qtyInput, setQtyInput] = useState("");
    const [error, setError] = useState<string | null>(null);

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

            <label className="order-entry__field">
                <span className="order-entry__label">Price</span>
                <input
                    className="order-entry__input"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={priceInput}
                    data-testid="price-input"
                    disabled={disabled}
                    onChange={(e) => setPriceInput(e.target.value)}
                />
            </label>

            <label className="order-entry__field">
                <span className="order-entry__label">Qty</span>
                <input
                    className="order-entry__input"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={qtyInput}
                    data-testid="qty-input"
                    disabled={disabled}
                    onChange={(e) => setQtyInput(e.target.value)}
                />
            </label>

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
}