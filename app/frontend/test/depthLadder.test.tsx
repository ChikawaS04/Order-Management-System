import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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

describe("buildLadder (P7-4 depth window and shading)", () => {
    it("caps each side to the selected depth, keeping the best levels nearest the mid", () => {
        const bids: Level[] = [
            [15000, 5],
            [14990, 5],
            [14980, 5],
            [14970, 5],
        ];
        const asks: Level[] = [
            [15025, 5],
            [15050, 5],
            [15075, 5],
            [15100, 5],
        ];
        const m = buildLadder(bids, asks, 2);
        expect(m.bids.map((r) => r.priceCents)).toEqual([15000, 14990]); // best two bids
        expect(m.asks.map((r) => r.priceCents)).toEqual([15050, 15025]); // best two asks, display order
    });

    it("cumulative quantity is monotonic from the touch outward on each side", () => {
        const bids: Level[] = [
            [15000, 3],
            [14990, 1],
            [14980, 4],
        ];
        const asks: Level[] = [
            [15025, 2],
            [15050, 6],
            [15075, 1],
        ];
        const m = buildLadder(bids, asks);

        // bids display best-first, so cumulation runs down the list
        const bidCum = m.bids.map((r) => r.cumQty);
        expect(bidCum).toEqual([3, 4, 8]);
        for (let i = 1; i < bidCum.length; i++) {
            expect(bidCum[i]).toBeGreaterThanOrEqual(bidCum[i - 1]);
        }

        // asks accumulate from the touch (lowest) then display furthest-first, so the
        // cumulative total decreases down the displayed list and rises back to the touch
        const askCum = m.asks.map((r) => r.cumQty);
        expect(askCum).toEqual([9, 8, 2]);
        for (let i = 1; i < askCum.length; i++) {
            expect(askCum[i]).toBeLessThanOrEqual(askCum[i - 1]);
        }
    });

    it("bounds every shading fraction to [0,1], saturating the heavy side at exactly 1", () => {
        const m = buildLadder(BIDS, ASKS, 10);
        for (const r of [...m.bids, ...m.asks]) {
            expect(r.shadeFraction).toBeGreaterThanOrEqual(0);
            expect(r.shadeFraction).toBeLessThanOrEqual(1);
        }
        expect(m.bids[m.bids.length - 1].shadeFraction).toBe(1); // furthest bid, heaviest side
    });

    it("normalises shading to the largest cumulative value in the VISIBLE window", () => {
        const bids: Level[] = [
            [15000, 1],
            [14990, 1],
            [14980, 100],
        ];
        const asks: Level[] = [
            [15025, 1],
            [15050, 1],
        ];

        // full depth: the 100-lot bid dominates, so asks read as slivers
        const full = buildLadder(bids, asks);
        expect(full.bids[full.bids.length - 1].shadeFraction).toBe(1);
        expect(full.asks[0].shadeFraction).toBeCloseTo(2 / 102);

        // depth 2 drops the 100-lot level: the visible bid total (2) matches the ask
        // total (2), so both sides rescale entirely off the smaller visible window
        const shallow = buildLadder(bids, asks, 2);
        expect(shallow.bids.map((r) => r.priceCents)).toEqual([15000, 14990]);
        expect(shallow.bids[shallow.bids.length - 1].shadeFraction).toBe(1);
        expect(shallow.asks[0].shadeFraction).toBe(1);
    });

    it("an empty or one-sided book yields zero shading with no NaN", () => {
        const empty = buildLadder([], []);
        expect(empty.bids).toEqual([]);
        expect(empty.asks).toEqual([]);

        const asksOnly = buildLadder([], ASKS);
        for (const r of asksOnly.asks) {
            expect(Number.isNaN(r.shadeFraction)).toBe(false);
            expect(Number.isNaN(r.widthPct)).toBe(false);
        }
        expect(asksOnly.asks[0].shadeFraction).toBe(1); // present side scales to its own max
    });

    it("emits exactly one row per real level and never a stale tail", () => {
        expect(buildLadder([[15000, 1]], [], 14).bids).toHaveLength(1);
        expect(buildLadder([], [], 14).bids).toHaveLength(0);

        // BOOK is authoritative and replaced wholesale, so a shrunk input shrinks the model
        const wide = buildLadder([[15000, 1], [14990, 1], [14980, 1]], [], 14);
        const narrow = buildLadder([[15000, 1]], [], 14);
        expect(wide.bids).toHaveLength(3);
        expect(narrow.bids).toHaveLength(1);
    });

    it("re-slices purely over the same snapshot when depth changes (no refetch)", () => {
        const bids: Level[] = [
            [15000, 1],
            [14990, 1],
            [14980, 1],
            [14970, 1],
        ];
        const asks: Level[] = [
            [15025, 1],
            [15050, 1],
            [15060, 1],
            [15070, 1],
        ];
        expect(buildLadder(bids, asks, 8).bids).toHaveLength(4); // depth exceeds the window
        expect(buildLadder(bids, asks, 2).bids).toHaveLength(2);
        expect(buildLadder(bids, asks, 2).asks.map((r) => r.priceCents)).toEqual([15050, 15025]);
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

describe("DepthLadder (P7-4 cumulative column, divider, depth selector)", () => {
    it("renders the cumulative-quantity column alongside per-level size", () => {
        render(
            <DepthLadder book={book({ bestBid: 15000, bestAsk: 15025, bids: BIDS, asks: ASKS })} />,
        );
        const bidRows = screen.getAllByTestId("bid-row");
        const cum = bidRows.map((r) => r.querySelector(".depth-ladder__cum")?.textContent);
        expect(cum).toEqual(["10", "14"]); // BIDS cumulate 10, then 14 down the list
    });

    it("shows spread, mid, and last in the divider", () => {
        render(
            <DepthLadder
                book={book({ bestBid: 15000, bestAsk: 15025, bids: BIDS, asks: ASKS })}
                lastCents={15025}
            />,
        );
        expect(screen.getByTestId("spread-value").textContent).toBe("0.25");
        expect(screen.getByTestId("mid-value").textContent).toBe("150.125");
        expect(screen.getByTestId("last-value").textContent).toBe("150.25");
    });

    it("blanks mid and last on an empty book, with no divide-by-zero", () => {
        render(<DepthLadder book={book({})} />);
        expect(screen.getByTestId("spread-value").textContent).toBe(EMPTY_PRICE);
        expect(screen.getByTestId("mid-value").textContent).toBe(EMPTY_PRICE);
        expect(screen.getByTestId("last-value").textContent).toBe(EMPTY_PRICE);
    });

    it("blanks last before the first trade even with a two-sided book", () => {
        render(
            <DepthLadder book={book({ bestBid: 15000, bestAsk: 15025, bids: BIDS, asks: ASKS })} />,
        );
        expect(screen.getByTestId("last-value").textContent).toBe(EMPTY_PRICE); // no lastCents -> -1 -> blank
        expect(screen.getByTestId("mid-value").textContent).toBe("150.125"); // mid still live from the book
    });

    it("re-slices to the selected depth without a new book prop (no refetch)", () => {
        const wideBook = book({
            bestBid: 15000,
            bestAsk: 15025,
            bids: [
                [15000, 1],
                [14990, 1],
                [14980, 1],
                [14970, 1],
                [14960, 1],
                [14950, 1],
                [14940, 1],
                [14930, 1],
                [14920, 1],
                [14910, 1],
                [14900, 1],
                [14890, 1],
            ],
            asks: [[15025, 1]],
        });
        render(<DepthLadder book={wideBook} />);
        expect(screen.getAllByTestId("bid-row")).toHaveLength(10); // default depth 10

        fireEvent.change(screen.getByTestId("depth-select"), { target: { value: "8" } });
        expect(screen.getAllByTestId("bid-row")).toHaveLength(8); // same book, selector alone re-slices
    });

    it("never shows a stale tail when the book shrinks", () => {
        const { rerender } = render(
            <DepthLadder
                book={book({ bestBid: 15000, bestAsk: -1, bids: [[15000, 1], [14990, 1], [14980, 1]], asks: [] })}
            />,
        );
        expect(screen.getAllByTestId("bid-row")).toHaveLength(3);

        rerender(
            <DepthLadder book={book({ bestBid: 15000, bestAsk: -1, bids: [[15000, 1]], asks: [] })} />,
        );
        expect(screen.getAllByTestId("bid-row")).toHaveLength(1);
    });
});