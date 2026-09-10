import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { DepthCurve } from "../src/components/DepthCurve";
import type { BookState } from "../src/state/reducer";
import type { Level } from "../src/protocol/messages";

// P5-0 chose no `globals: true`, so RTL's auto-cleanup never registers. Wire it
// explicitly to keep renders isolated.
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

function twoSided(): BookState {
    return book({ bestBid: 15000, bestAsk: 15025, bids: BIDS, asks: ASKS });
}

describe("DepthCurve (click-to-price mapping)", () => {
    it("maps a click on a bid level's band to that level's cent price", () => {
        const onPriceSelect = vi.fn();
        render(<DepthCurve book={twoSided()} onPriceSelect={onPriceSelect} />);

        fireEvent.click(screen.getByTestId("curve-hit-15000"));
        expect(onPriceSelect).toHaveBeenCalledWith(15000);

        fireEvent.click(screen.getByTestId("curve-hit-14990"));
        expect(onPriceSelect).toHaveBeenCalledWith(14990);
    });

    it("maps a click on an ask level's band to that level's cent price (real level, snapped)", () => {
        const onPriceSelect = vi.fn();
        render(<DepthCurve book={twoSided()} onPriceSelect={onPriceSelect} />);

        fireEvent.click(screen.getByTestId("curve-hit-15025"));
        expect(onPriceSelect).toHaveBeenCalledWith(15025);

        fireEvent.click(screen.getByTestId("curve-hit-15050"));
        expect(onPriceSelect).toHaveBeenCalledWith(15050);
    });

    it("exposes exactly one hit band per real level across both sides", () => {
        const { container } = render(<DepthCurve book={twoSided()} />);
        const bands = container.querySelectorAll('[data-testid^="curve-hit-"]');
        expect(bands).toHaveLength(4); // two bids + two asks, distinct prices
    });

    it("does not throw when a band is clicked with no handler wired", () => {
        render(<DepthCurve book={twoSided()} />);
        expect(() => fireEvent.click(screen.getByTestId("curve-hit-15000"))).not.toThrow();
    });
});

describe("DepthCurve (mid marker and guards)", () => {
    it("marks the mid, labelled half-cent-safe, on a two-sided book", () => {
        render(<DepthCurve book={twoSided()} />);
        const mid = screen.getByTestId("depth-curve-mid");
        // midpointLabel(15000, 15025) -> "150.125"; numeric mid 15012.5 positions it
        expect(mid.textContent).toContain("150.125");
    });

    it("plots a one-sided book with no mid marker and only the present side's bands", () => {
        const { container } = render(
            <DepthCurve book={book({ bestAsk: 15025, asks: [[15025, 5]] })} />,
        );
        expect(screen.queryByTestId("depth-curve-mid")).toBeNull();
        expect(screen.getByTestId("curve-hit-15025")).not.toBeNull();
        expect(screen.queryByTestId("curve-hit-15000")).toBeNull();
        expect(container.querySelectorAll('[data-testid^="curve-hit-"]')).toHaveLength(1);
    });

    it("renders an empty book with no mid and no bands, no crash", () => {
        const { container } = render(<DepthCurve book={book({})} />);
        expect(screen.getByTestId("depth-curve")).not.toBeNull();
        expect(screen.queryByTestId("depth-curve-mid")).toBeNull();
        expect(container.querySelectorAll('[data-testid^="curve-hit-"]')).toHaveLength(0);
    });
});