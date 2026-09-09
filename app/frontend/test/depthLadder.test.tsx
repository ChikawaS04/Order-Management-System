import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { DepthLadder, buildLadder, spreadLabel } from "../src/components/DepthLadder";
import { EMPTY_PRICE } from "../src/format";
import type { BookState } from "../src/state/reducer";
import type { Level } from "../src/protocol/messages";

// P5-0 chose no `globals: true`, so RTL's auto-cleanup (which looks for a global
// afterEach) never registers. Wire it explicitly to keep renders isolated.
afterEach(cleanup);

function book(partial: Partial<BookState>): BookState {
    return { bestBid: -1, bestAsk: -1, bids: [], asks: [], timestamp: 0, ...partial };
}

const BIDS: Level[] = [
    [15000, 10],
    [14990, 4],
];
const ASKS: Level[] = [
    [15025, 5],
    [15050, 3],
];

describe("buildLadder (pure)", () => {
    it("accumulates quantity best-first on each side", () => {
        const m = buildLadder(BIDS, ASKS);
        // bids highest-first: 15000 (cum 10), 14990 (cum 14)
        expect(m.bids.map((r) => r.priceCents)).toEqual([15000, 14990]);
        expect(m.bids.map((r) => r.cumQty)).toEqual([10, 14]);
        // asks accumulate lowest-first (5, then 8) but display highest-first
        expect(m.asks.map((r) => r.priceCents)).toEqual([15050, 15025]);
        expect(m.asks.map((r) => r.cumQty)).toEqual([8, 5]);
    });

    it("scales both sides to the shared max (imbalance is visible)", () => {
        // bid depth 14, ask depth 8 -> sharedMax 14
        const m = buildLadder(BIDS, ASKS);
        const bidWidths = m.bids.map((r) => r.widthPct);
        expect(bidWidths[bidWidths.length - 1]).toBe(100); // furthest bid = full
        expect(m.asks[0].widthPct).toBeCloseTo((8 / 14) * 100); // furthest ask < full
    });

    it("bar width grows monotonically outward from the mid", () => {
        const m = buildLadder(BIDS, ASKS);
        // bids display nearest-mid first -> width increases down the list
        expect(m.bids[0].widthPct).toBeLessThanOrEqual(m.bids[1].widthPct);
        // asks display furthest first -> width decreases down the list
        expect(m.asks[0].widthPct).toBeGreaterThanOrEqual(m.asks[1].widthPct);
    });

    it("preserves display ordering: both sides highest-price-first", () => {
        const m = buildLadder(
            [
                [15000, 10],
                [14990, 4],
                [14980, 2],
            ],
            [
                [15025, 5],
                [15050, 3],
                [15075, 1],
            ],
        );
        expect(m.asks.map((r) => r.priceCents)).toEqual([15075, 15050, 15025]);
        expect(m.bids.map((r) => r.priceCents)).toEqual([15000, 14990, 14980]);
    });

    it("handles an empty book without NaN", () => {
        const m = buildLadder([], []);
        expect(m.asks).toEqual([]);
        expect(m.bids).toEqual([]);
    });

    it("handles a one-sided book (present side scales to its own max)", () => {
        const asksOnly = buildLadder([], ASKS);
        expect(asksOnly.bids).toEqual([]);
        expect(asksOnly.asks[0].widthPct).toBe(100); // furthest ask, cum 8 / max 8

        const bidsOnly = buildLadder([[15000, 10]], []);
        expect(bidsOnly.asks).toEqual([]);
        expect(bidsOnly.bids[0].widthPct).toBe(100);
    });
});

describe("spreadLabel (sentinel guard)", () => {
    it("computes spread only when both tops are real", () => {
        expect(spreadLabel(15000, 15025)).toBe("0.25");
    });

    it("returns EMPTY_PRICE when either or both tops are the -1 sentinel", () => {
        expect(spreadLabel(-1, 15025)).toBe(EMPTY_PRICE);
        expect(spreadLabel(15000, -1)).toBe(EMPTY_PRICE);
        expect(spreadLabel(-1, -1)).toBe(EMPTY_PRICE);
    });
});

describe("DepthLadder (render)", () => {
    it("renders one row per level with dollar-formatted prices", () => {
        render(
            <DepthLadder book={book({ bestBid: 15000, bestAsk: 15025, bids: BIDS, asks: ASKS })} />,
        );
        expect(screen.getAllByTestId("ask-row")).toHaveLength(2);
        expect(screen.getAllByTestId("bid-row")).toHaveLength(2);
        expect(screen.queryByText("150.25")).not.toBeNull();
        expect(screen.queryByText("150.00")).not.toBeNull();
    });

    it("orders asks highest-first and bids highest-first in the DOM", () => {
        render(
            <DepthLadder book={book({ bestBid: 15000, bestAsk: 15025, bids: BIDS, asks: ASKS })} />,
        );
        const askRows = screen.getAllByTestId("ask-row");
        expect(askRows[0].textContent).toContain("150.50"); // top = highest ask
        expect(askRows[askRows.length - 1].textContent).toContain("150.25"); // best ask nearest mid

        const bidRows = screen.getAllByTestId("bid-row");
        expect(bidRows[0].textContent).toContain("150.00"); // best bid nearest mid
        expect(bidRows[bidRows.length - 1].textContent).toContain("149.90");
    });

    it("shows the true spread and never leaks a sentinel as a price", () => {
        render(
            <DepthLadder book={book({ bestBid: 15000, bestAsk: 15025, bids: BIDS, asks: ASKS })} />,
        );
        expect(screen.getByTestId("spread-value").textContent).toBe("0.25");

        const rows = [...screen.getAllByTestId("ask-row"), ...screen.getAllByTestId("bid-row")];
        for (const r of rows) {
            const price = r.querySelector(".depth-ladder__price")?.textContent ?? "";
            expect(price).not.toBe(EMPTY_PRICE);
            expect(price.startsWith("-")).toBe(false);
        }

        // furthest bid is the heavy side here -> full-width bar (ties pure math to DOM)
        const bidRows = screen.getAllByTestId("bid-row");
        const furthestBar = bidRows[bidRows.length - 1].querySelector(
            ".depth-ladder__bar",
        ) as HTMLElement;
        expect(furthestBar.style.width).toBe("100%");
    });

    it("renders a one-sided book cleanly with a guarded spread", () => {
        render(
            <DepthLadder book={book({ bestBid: -1, bestAsk: 15025, bids: [], asks: [[15025, 5]] })} />,
        );
        expect(screen.queryAllByTestId("bid-row")).toHaveLength(0);
        expect(screen.getAllByTestId("ask-row")).toHaveLength(1);
        // best ask price still shows as a row, but the spread is guarded to EMPTY_PRICE
        expect(screen.getByTestId("spread-value").textContent).toBe(EMPTY_PRICE);
    });

    it("renders an empty book with no rows and an empty spread", () => {
        render(<DepthLadder book={book({})} />);
        expect(screen.queryAllByTestId("ask-row")).toHaveLength(0);
        expect(screen.queryAllByTestId("bid-row")).toHaveLength(0);
        expect(screen.getByTestId("spread-value").textContent).toBe(EMPTY_PRICE);
    });
});