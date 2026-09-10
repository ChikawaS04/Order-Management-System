/**
 * Price formatting primitives for the OMS frontend.
 *
 * Cents are the internal unit everywhere (Phase 5 decision 4). Dollars appear
 * only at the render/parse edge, and every conversion here is string-based
 * integer math — no floating-point arithmetic ever touches a price, so a value
 * like 150.25 can never drift to 150.249999….
 */

/** Rendered in place of an absent price (the backend's -1L sentinel). */
export const EMPTY_PRICE = '—'

/**
 * Convert integer cents to a fixed two-decimal dollar string.
 *
 * Any negative value is the "no price" sentinel (the backend uses -1L for empty
 * book sides and NA fields) and renders as EMPTY_PRICE — never as a negative
 * dollar amount. Non-integer / non-finite input is likewise rejected to
 * EMPTY_PRICE, since cents on the wire are always whole numbers.
 *
 *   5     -> "0.05"
 *   15020 -> "150.20"
 *   15025 -> "150.25"
 *   15000 -> "150.00"
 *   -1    -> "—"
 */
export function centsToDollars(cents: number): string {
    if (!Number.isInteger(cents) || cents < 0) {
        return EMPTY_PRICE
    }
    // Zero-pad to at least three digits so there are always two fractional
    // digits to slice off the end: 5 -> "005" -> "0" + "05".
    const digits = String(cents).padStart(3, '0')
    const whole = digits.slice(0, -2)
    const fraction = digits.slice(-2)
    return `${whole}.${fraction}`
}

/**
 * Midpoint of two cent prices as a half-cent-safe dollar string, integer math
 * only (no float on the price path). The mid is (bid + ask) / 2, a half-cent
 * when the sum is odd; centsToDollars renders whole cents, so the trailing
 * half-cent is appended as "5": 15000/15025 gives "150.125". EMPTY_PRICE unless
 * both sides are real, guarding the -1 empty-book sentinel the same way every
 * other formatter here does.
 *
 * Moved here in P7-4 (it began as a private helper in Header.tsx) so the header
 * instrument row and the depth-ladder divider share one definition rather than
 * each keeping its own copy of the half-cent logic.
 *
 *   15000, 15050 -> "150.25"
 *   15000, 15025 -> "150.125"
 *   -1,    15025 -> "—"
 */
export function midpointLabel(bestBid: number, bestAsk: number): string {
    if (bestBid <= 0 || bestAsk <= 0) {
        return EMPTY_PRICE
    }
    const sum = bestBid + bestAsk
    const whole = (sum - (sum % 2)) / 2
    const base = centsToDollars(whole)
    return sum % 2 === 0 ? base : `${base}5`
}

/**
 * Numeric midpoint of two cent prices, for POSITIONING only, never an order
 * price. midpointLabel above is the display string; a plotted mid marker needs a
 * number for its coordinate, so this is computed rather than parsed back out of
 * that string. The mid is (bid + ask) / 2, which is a half-cent (x.5) when the
 * sum is odd; that fractional value is fine here because it is a render-edge
 * position, not a price on the wire. Returns null unless both sides are real,
 * guarding the -1 sentinel exactly as midpointLabel does, so a one-sided or empty
 * book plots no marker.
 *
 *   15000, 15050 -> 15025
 *   15000, 15025 -> 15012.5
 *   -1,    15025 -> null
 */
export function midpointCents(bestBid: number, bestAsk: number): number | null {
    if (bestBid <= 0 || bestAsk <= 0) {
        return null
    }
    return (bestBid + bestAsk) / 2
}

/**
 * Parse a dollar string to integer cents, mirroring the backend parsePrice
 * policy (Phase 3): strictly positive, at most two decimal places, no float.
 *
 * Returns null on anything the backend would reject, so bad input is caught
 * locally before send (Phase 5 decision 6 — the server exposes no reject
 * feedback path):
 *
 *   "150"     -> 15000
 *   "150.2"   -> 15020
 *   "0.05"    -> 5
 *   "150.25"  -> 15025
 *   "150.255" -> null   (> 2 decimals)
 *   "150."    -> null   (dangling dot)
 *   ".5"      -> null   (no integer part)
 *   "0"       -> null   (not > 0)
 *   "-1"      -> null   (sign not permitted by the grammar)
 *   ""        -> null
 *   "abc"     -> null
 */
export function dollarsToCents(input: string): number | null {
    const trimmed = input.trim()

    // Grammar: one or more digits, optionally a dot and one or two digits.
    // The integer part is mandatory (".5" is rejected, matching the backend's
    // empty-integer-part rejection); no sign, no exponent, no separators.
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed)
    if (match === null) {
        return null
    }

    const wholePart = match[1]
    const fractionPart = (match[2] ?? '').padEnd(2, '0')

    // String concatenation, not "* 100" — keeps the whole path in integer land.
    const cents = Number(wholePart + fractionPart)

    // Reject zero / non-positive and any pathological non-safe-integer result.
    if (!Number.isSafeInteger(cents) || cents <= 0) {
        return null
    }

    return cents
}

/** Clock display precision: milliseconds (default) or full nanoseconds. */
export type ClockPrecision = 'ms' | 'ns'

/**
 * Epoch-nanos to a wall-clock time string in local time.
 *
 * At 'ms' (default) this is HH:MM:SS.mmm, byte-identical to the P7-3 header
 * clock whose logic moved here in P7-6 so the header and the trade tape share
 * one formatter instead of duplicating it. At 'ns' it extends to nine fractional
 * digits (HH:MM:SS.nnnnnnnnn); the sub-second part is taken by exact BigInt
 * integer math from the value in state, and H:M:S comes from Date so local time
 * and midnight rollover are handled once.
 *
 * Precision limit, stated rather than hidden: a real epoch-nanos value (~1.75e18
 * in 2026) exceeds Number.MAX_SAFE_INTEGER, so it arrives already rounded by the
 * JSON-number transport (an IEEE-754 double, ULP ~256 ns near 2026). Milliseconds
 * are exact; digits below roughly a microsecond reflect that transport rounding,
 * not engine truth. True nanosecond fidelity would need a string-encoded wire
 * timestamp, which is out of P7-6 scope. EMPTY_PRICE when no frame has arrived.
 */
export function formatClockNanos(nanos: number, precision: ClockPrecision = 'ms'): string {
    if (nanos <= 0) return EMPTY_PRICE
    const ms = Math.floor(nanos / 1_000_000)
    const d = new Date(ms)
    const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
    const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    if (precision === 'ms') {
        return `${hms}.${pad(d.getMilliseconds(), 3)}`
    }
    // Nanoseconds within the second, exact integer math on the value in state.
    const withinSecond = Number(BigInt(Math.trunc(nanos)) % 1_000_000_000n)
    return `${hms}.${pad(withinSecond, 9)}`
}