import { describe, expect, it } from "vitest";

import { deriveHeader } from "../src/components/Header";
import { EMPTY_PRICE } from "../src/format";
import type { BookState } from "../src/state/reducer";

function book(bestBid: number, bestAsk: number): BookState {
    return { bestBid, bestAsk, bids: [], asks: [], timestamp: 0 };
}

describe("deriveHeader", () => {
    it("formats a two-sided book with an even-cent midpoint", () => {
        // mid = (15000 + 15050) / 2 = 15025 -> 150.25 ; spread = 50 -> 0.50
        expect(deriveHeader(book(15000, 15050))).toEqual({
            bestBid: "150.00",
            bestAsk: "150.50",
            mid: "150.25",
            spread: "0.50",
        });
    });

    it("renders a half-cent midpoint exactly (no truncation, no float)", () => {
        // mid = (15000 + 15025) / 2 = 15012.5 -> "150.125"
        expect(deriveHeader(book(15000, 15025))).toEqual({
            bestBid: "150.00",
            bestAsk: "150.25",
            mid: "150.125",
            spread: "0.25",
        });
    });

    it("handles sub-dollar prices", () => {
        // mid = (3 + 5) / 2 = 4 -> 0.04 ; spread = 2 -> 0.02
        expect(deriveHeader(book(3, 5))).toEqual({
            bestBid: "0.03",
            bestAsk: "0.05",
            mid: "0.04",
            spread: "0.02",
        });
    });

    it("shows EMPTY_PRICE for mid, spread, and the missing side when ask is absent", () => {
        expect(deriveHeader(book(15000, -1))).toEqual({
            bestBid: "150.00",
            bestAsk: EMPTY_PRICE,
            mid: EMPTY_PRICE,
            spread: EMPTY_PRICE,
        });
    });

    it("shows EMPTY_PRICE for mid, spread, and the missing side when bid is absent", () => {
        expect(deriveHeader(book(-1, 15025))).toEqual({
            bestBid: EMPTY_PRICE,
            bestAsk: "150.25",
            mid: EMPTY_PRICE,
            spread: EMPTY_PRICE,
        });
    });

    it("shows EMPTY_PRICE for everything on an empty book", () => {
        expect(deriveHeader(book(-1, -1))).toEqual({
            bestBid: EMPTY_PRICE,
            bestAsk: EMPTY_PRICE,
            mid: EMPTY_PRICE,
            spread: EMPTY_PRICE,
        });
    });

    it("never leaks a sentinel as a signed or bogus price", () => {
        for (const model of [deriveHeader(book(15000, -1)), deriveHeader(book(-1, -1))]) {
            for (const value of Object.values(model)) {
                expect(value.includes("-")).toBe(false);
            }
        }
    });
});