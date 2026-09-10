import { describe, expect, it } from "vitest";

import { createClOrdIdGenerator } from "../src/protocol/encode";

describe("clOrdId generator peek (P7-7)", () => {
    it("peek returns the id the next call will use, without consuming it", () => {
        const gen = createClOrdIdGenerator(1000);
        expect(gen.peek()).toBe(1000);
        expect(gen.peek()).toBe(1000); // idempotent: peeking never advances
        expect(gen()).toBe(1000); // the very id peek promised
        expect(gen.peek()).toBe(1001); // now the next one
    });

    it("peek tracks the monotonic sequence across consumption", () => {
        const gen = createClOrdIdGenerator(500);
        const seen: number[] = [];
        for (let i = 0; i < 3; i++) {
            seen.push(gen.peek());
            expect(gen()).toBe(seen[i]); // each call yields exactly the peeked id
        }
        expect(seen).toEqual([500, 501, 502]);
        expect(gen.peek()).toBe(503);
    });

    it("still increments monotonically from the seed (next behaviour unchanged)", () => {
        const gen = createClOrdIdGenerator(10);
        expect(gen()).toBe(10);
        expect(gen()).toBe(11);
        expect(gen()).toBe(12);
    });

    it("still rejects an invalid seed (guard unchanged)", () => {
        expect(() => createClOrdIdGenerator(0)).toThrow(RangeError);
        expect(() => createClOrdIdGenerator(-1)).toThrow(RangeError);
        expect(() => createClOrdIdGenerator(1.5)).toThrow(RangeError);
    });
});