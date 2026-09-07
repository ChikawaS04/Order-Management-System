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