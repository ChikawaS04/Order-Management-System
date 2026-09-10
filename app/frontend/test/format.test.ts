import { describe, it, expect } from 'vitest'
import {
    centsToDollars,
    dollarsToCents,
    EMPTY_PRICE,
    formatClockNanos,
    midpointCents,
    midpointLabel,
} from '../src/format'

describe('centsToDollars', () => {
    it('formats sub-dollar values with a leading zero', () => {
        expect(centsToDollars(5)).toBe('0.05')
        expect(centsToDollars(1)).toBe('0.01')
        expect(centsToDollars(99)).toBe('0.99')
    })

    it('formats whole and fractional dollar values to two places', () => {
        expect(centsToDollars(15000)).toBe('150.00')
        expect(centsToDollars(15020)).toBe('150.20')
        expect(centsToDollars(15025)).toBe('150.25')
        expect(centsToDollars(100)).toBe('1.00')
    })

    it('renders the -1 sentinel (and any negative) as the empty marker', () => {
        expect(EMPTY_PRICE).toBe('—')
        expect(centsToDollars(-1)).toBe(EMPTY_PRICE)
        expect(centsToDollars(-9999)).toBe(EMPTY_PRICE)
    })

    it('rejects non-integer / non-finite cents to the empty marker', () => {
        expect(centsToDollars(150.5)).toBe(EMPTY_PRICE)
        expect(centsToDollars(Number.NaN)).toBe(EMPTY_PRICE)
        expect(centsToDollars(Number.POSITIVE_INFINITY)).toBe(EMPTY_PRICE)
    })

    it('round-trips through dollarsToCents for valid prices', () => {
        for (const cents of [1, 5, 100, 15020, 15025, 999999]) {
            expect(dollarsToCents(centsToDollars(cents))).toBe(cents)
        }
    })
})

describe('midpointLabel', () => {
    it('renders an even-sum mid to two places', () => {
        expect(midpointLabel(15000, 15050)).toBe('150.25')
        expect(midpointLabel(3, 5)).toBe('0.04')
    })

    it('renders an odd-sum mid with an exact trailing half-cent, no float drift', () => {
        expect(midpointLabel(15000, 15025)).toBe('150.125')
        expect(midpointLabel(1, 2)).toBe('0.015')
    })

    it('blanks to the empty marker when either side is the -1 sentinel', () => {
        expect(midpointLabel(-1, 15025)).toBe(EMPTY_PRICE)
        expect(midpointLabel(15000, -1)).toBe(EMPTY_PRICE)
        expect(midpointLabel(-1, -1)).toBe(EMPTY_PRICE)
    })
})

describe('midpointCents', () => {
    it('returns the exact integer mid for an even-sum book', () => {
        expect(midpointCents(15000, 15050)).toBe(15025)
        expect(midpointCents(3, 5)).toBe(4)
    })

    it('returns the half-cent mid for an odd-sum book (positioning only)', () => {
        expect(midpointCents(15000, 15025)).toBe(15012.5)
        expect(midpointCents(1, 2)).toBe(1.5)
    })

    it('returns null when either side is the -1 sentinel', () => {
        expect(midpointCents(-1, 15025)).toBeNull()
        expect(midpointCents(15000, -1)).toBeNull()
        expect(midpointCents(-1, -1)).toBeNull()
    })
})

describe('formatClockNanos', () => {
    it('blanks when no frame has arrived', () => {
        expect(formatClockNanos(0)).toBe(EMPTY_PRICE)
        expect(formatClockNanos(-1)).toBe(EMPTY_PRICE)
    })

    it('renders HH:MM:SS.mmm shape at millisecond precision (default)', () => {
        // Real epoch magnitude exceeds Number.MAX_SAFE_INTEGER, so assert the shape,
        // exactly as header.test.ts does; milliseconds are exact and the value is real.
        expect(formatClockNanos(1_700_000_000_123_456_789)).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)
    })

    it('renders nine fractional digits at nanosecond precision', () => {
        expect(formatClockNanos(1_700_000_000_123_456_789, 'ns')).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{9}$/)
    })

    it('extracts sub-second digits with exact integer math (small exact values)', () => {
        // Below 2^53 the value is exact, so the fractional digits are asserted exactly.
        // The wall-clock H:M:S is timezone-dependent, so only the fraction is pinned.
        expect(formatClockNanos(7, 'ns')).toMatch(/\.000000007$/)
        expect(formatClockNanos(999_999, 'ns')).toMatch(/\.000999999$/)
        expect(formatClockNanos(1_000_000_000 + 123_456_789, 'ns')).toMatch(/\.123456789$/)
    })

    it('rolls the wall clock over local midnight', () => {
        // Anchor to a local Date so the assertion is timezone-independent. A +0.5ms
        // cushion keeps floor(nanos / 1e6) exact despite double rounding at this
        // magnitude, so the displayed second is deterministic.
        const before = new Date(2026, 0, 2, 23, 59, 59, 500).getTime()
        expect(formatClockNanos(before * 1_000_000 + 500_000)).toBe('23:59:59.500')
        expect(formatClockNanos((before + 1000) * 1_000_000 + 500_000)).toBe('00:00:00.500')
    })
})

describe('dollarsToCents', () => {
    it('parses integer dollars', () => {
        expect(dollarsToCents('150')).toBe(15000)
        expect(dollarsToCents('1')).toBe(100)
    })

    it('parses one- and two-decimal dollars via string math', () => {
        expect(dollarsToCents('150.2')).toBe(15020)
        expect(dollarsToCents('150.25')).toBe(15025)
        expect(dollarsToCents('0.05')).toBe(5)
        expect(dollarsToCents('0.01')).toBe(1)
        expect(dollarsToCents('150.00')).toBe(15000)
    })

    it('trims surrounding whitespace', () => {
        expect(dollarsToCents('  150.25  ')).toBe(15025)
    })

    it('rejects more than two decimal places', () => {
        expect(dollarsToCents('150.255')).toBeNull()
        expect(dollarsToCents('0.001')).toBeNull()
    })

    it('rejects a dangling dot or a missing integer part', () => {
        expect(dollarsToCents('150.')).toBeNull()
        expect(dollarsToCents('.5')).toBeNull()
        expect(dollarsToCents('.')).toBeNull()
    })

    it('rejects zero and non-positive values', () => {
        expect(dollarsToCents('0')).toBeNull()
        expect(dollarsToCents('0.00')).toBeNull()
        expect(dollarsToCents('-1')).toBeNull()
        expect(dollarsToCents('-150.25')).toBeNull()
    })

    it('rejects empty and non-numeric input', () => {
        expect(dollarsToCents('')).toBeNull()
        expect(dollarsToCents('   ')).toBeNull()
        expect(dollarsToCents('abc')).toBeNull()
        expect(dollarsToCents('12.3abc')).toBeNull()
        expect(dollarsToCents('1e3')).toBeNull()
        expect(dollarsToCents('1,000')).toBeNull()
    })
})