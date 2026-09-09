import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TradeTape } from "../src/components/TradeTape";
import { EMPTY_PRICE } from "../src/format";
import type { TapeEntry } from "../src/state/reducer";

// P5-0's no-globals stance means RTL's auto-cleanup never registers; wire it
// explicitly so renders don't bleed across tests (same as depthLadder.test.tsx).
afterEach(cleanup);

/** A valid fill TapeEntry; override only the fields a case cares about. */
function entry(overrides: Partial<TapeEntry> = {}): TapeEntry {
    return {
        tradeId: 1,
        priceCents: 15000,
        quantity: 10,
        aggressorOrderId: 2,
        passiveOrderId: 1,
        timestamp: 0,
        mine: false,
        ...overrides,
    };
}

function priceOf(row: HTMLElement): string {
    return row.querySelector(".trade-tape__price")!.textContent ?? "";
}
function qtyOf(row: HTMLElement): string {
    return row.querySelector(".trade-tape__qty")!.textContent ?? "";
}

describe("TradeTape", () => {
    it("renders exactly the entries it is given (one row per TapeEntry)", () => {
        // The component only accepts TapeEntry[], which the reducer builds fills-only;
        // a 1:1 row count is the structural guarantee that non-fills never appear.
        const tape = [entry({ tradeId: 3 }), entry({ tradeId: 2 }), entry({ tradeId: 1 })];
        render(<TradeTape tape={tape} />);
        expect(screen.getAllByTestId("tape-row")).toHaveLength(3);
    });

    it("preserves slice order (newest-first as handed in)", () => {
        const tape = [
            entry({ tradeId: 3, priceCents: 15030 }),
            entry({ tradeId: 2, priceCents: 15020 }),
            entry({ tradeId: 1, priceCents: 15010 }),
        ];
        render(<TradeTape tape={tape} />);
        const prices = screen.getAllByTestId("tape-row").map(priceOf);
        expect(prices).toEqual(["150.30", "150.20", "150.10"]);
    });

    it("renders price in dollars via format.ts, never a sentinel or negative", () => {
        const tape = [entry({ tradeId: 1, priceCents: 5 }), entry({ tradeId: 2, priceCents: 15025 })];
        render(<TradeTape tape={tape} />);
        const prices = screen.getAllByTestId("tape-row").map(priceOf);
        expect(prices).toEqual(["0.05", "150.25"]);
        for (const p of prices) {
            expect(p).not.toBe(EMPTY_PRICE);
            expect(p.startsWith("-")).toBe(false);
            expect(p).toMatch(/^\d+\.\d{2}$/);
        }
    });

    it("renders the filled quantity", () => {
        render(<TradeTape tape={[entry({ quantity: 7 })]} />);
        expect(qtyOf(screen.getByTestId("tape-row"))).toBe("7");
    });

    it("marks the client's own fills with the --mine modifier", () => {
        const tape = [entry({ tradeId: 1, mine: true }), entry({ tradeId: 2, mine: false })];
        render(<TradeTape tape={tape} />);
        const rows = screen.getAllByTestId("tape-row");
        expect(rows[0].className).toContain("trade-tape__row--mine");
        expect(rows[1].className).not.toContain("trade-tape__row--mine");
    });

    it("never renders a side (no EXEC carries one; omitted by design)", () => {
        const { container } = render(<TradeTape tape={[entry({ mine: true })]} />);
        expect(container.textContent).not.toMatch(/BUY|SELL/);
    });

    it("renders an empty state cleanly with no rows", () => {
        render(<TradeTape tape={[]} />);
        expect(screen.queryAllByTestId("tape-row")).toHaveLength(0);
        expect(screen.getByTestId("tape-empty")).toBeTruthy();
    });
});