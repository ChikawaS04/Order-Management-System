import { describe, it, expect } from 'vitest'
import { centsToDollars, dollarsToCents, EMPTY_PRICE } from '../src/format'

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