import { describe, expect, it } from "vitest";

import {
    applyPreset,
    midChipCents,
    nudgeCents,
    QTY_PRESETS,
    TICK_CENTS,
} from "../src/components/OrderEntry";

describe("midChipCents", () => {
    it("returns the exact integer mid for an even-sum book", () => {
        expect(midChipCents(15000, 15050)).toBe(15025);
        expect(midChipCents(3, 5)).toBe(4);
    });

    it("rounds an odd-sum (half-cent) mid up to the nearest whole cent", () => {
        expect(midChipCents(15000, 15025)).toBe(15013); // true mid 15012.5 -> 15013
        expect(midChipCents(1, 2)).toBe(2); // true mid 1.5 -> 2
    });

    it("always yields a positive whole cent, never a half-cent on the price path", () => {
        for (const [b, a] of [[15000, 15025], [1, 2], [7, 8], [99, 100]] as const) {
            const m = midChipCents(b, a);
            expect(m).not.toBeNull();
            expect(Number.isInteger(m as number)).toBe(true);
            expect(m as number).toBeGreaterThan(0);
        }
    });

    it("returns null when either side is the -1 sentinel (chip disabled)", () => {
        expect(midChipCents(-1, 15025)).toBeNull();
        expect(midChipCents(15000, -1)).toBeNull();
        expect(midChipCents(-1, -1)).toBeNull();
    });
});

describe("nudgeCents", () => {
    it("adds and subtracts one tick (one cent) by default", () => {
        expect(TICK_CENTS).toBe(1);
        expect(nudgeCents(15000, 1)).toBe(15001);
        expect(nudgeCents(15000, -1)).toBe(14999);
    });

    it("never produces a non-positive price, clamping at the one-cent floor", () => {
        expect(nudgeCents(1, -1)).toBe(1);
        expect(nudgeCents(1, -5)).toBe(1);
        expect(nudgeCents(2, -10)).toBe(1);
    });

    it("never produces a non-integer price for integer input", () => {
        for (let c = 1; c <= 20; c++) {
            for (const s of [-3, -1, 1, 3]) {
                const n = nudgeCents(c, s);
                expect(Number.isInteger(n)).toBe(true);
                expect(n).toBeGreaterThan(0);
            }
        }
    });
});

describe("applyPreset", () => {
    it("fills the quantity when the field is empty (or whitespace)", () => {
        expect(applyPreset("", 100)).toBe("100");
        expect(applyPreset("   ", 50)).toBe("50");
    });

    it("does not clobber an already-typed quantity", () => {
        expect(applyPreset("7", 100)).toBe("7");
        expect(applyPreset("250", 500)).toBe("250");
    });

    it("offers round-lot presets", () => {
        expect(QTY_PRESETS).toEqual([10, 50, 100, 500]);
    });
});