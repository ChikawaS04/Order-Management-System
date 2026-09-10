import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

import { OrderEntry, validateOrderInput } from "../src/components/OrderEntry";
import type { OrderEntryHandle } from "../src/components/OrderEntry";

// P5-0's no-`globals` stance means RTL's auto-cleanup never registers; wire it
// explicitly so renders don't bleed across tests.
afterEach(cleanup);

const price = () => screen.getByTestId("price-input") as HTMLInputElement;
const qty = () => screen.getByTestId("qty-input") as HTMLInputElement;

describe("validateOrderInput", () => {
    it("accepts a valid price and quantity, returning integer cents and an int qty", () => {
        expect(validateOrderInput("150.25", "10")).toEqual({ ok: true, priceCents: 15025, qty: 10 });
        expect(validateOrderInput("0.05", "1")).toEqual({ ok: true, priceCents: 5, qty: 1 });
        expect(validateOrderInput("150", "3")).toEqual({ ok: true, priceCents: 15000, qty: 3 });
        expect(validateOrderInput("  150.00  ", " 4 ")).toEqual({ ok: true, priceCents: 15000, qty: 4 });
    });

    it("rejects prices with more than two decimals", () => {
        const r = validateOrderInput("150.255", "10");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/price/i);
    });

    it("rejects zero, negative, and non-numeric prices (mirrors backend parsePrice)", () => {
        for (const p of ["0", "0.00", "-1", "abc", "", "1e3", "1,000", "150.", ".5"]) {
            const r = validateOrderInput(p, "10");
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.reason).toMatch(/price/i);
        }
    });

    it("rejects zero, negative, fractional, and non-numeric quantities", () => {
        for (const q of ["0", "-1", "1.5", "abc", "", " "]) {
            const r = validateOrderInput("150.00", q);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.reason).toMatch(/quantity/i);
        }
    });
});

describe("<OrderEntry />", () => {
    it("submits a valid order exactly once with side, integer cents, and int qty", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} />);

        fireEvent.change(price(), { target: { value: "150.25" } });
        fireEvent.change(qty(), { target: { value: "10" } });
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith("BUY", 15025, 10);
    });

    it("emits SELL after toggling side", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} />);

        fireEvent.click(screen.getByTestId("side-sell"));
        fireEvent.change(price(), { target: { value: "1.00" } });
        fireEvent.change(qty(), { target: { value: "2" } });
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(onSubmit).toHaveBeenCalledWith("SELL", 100, 2);
    });

    it("blocks invalid input: shows a reason and does not call onSubmit", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} />);

        fireEvent.change(price(), { target: { value: "150.255" } });
        fireEvent.change(qty(), { target: { value: "10" } });
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByTestId("order-entry-error").textContent).toMatch(/price/i);
    });

    it("clears price and qty after a successful submit, keeping side", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} />);

        fireEvent.change(price(), { target: { value: "150.00" } });
        fireEvent.change(qty(), { target: { value: "5" } });
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(price().value).toBe("");
        expect(qty().value).toBe("");
    });

    it("uses plain click handlers, not an HTML form submit", () => {
        const { container } = render(<OrderEntry onSubmit={vi.fn()} />);
        expect(container.querySelector("form")).toBeNull();
    });

    it("is inert and visibly disabled when the disabled prop is set", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} disabled bestBidCents={15000} bestAskCents={15025} />);

        expect(price().disabled).toBe(true);
        expect(qty().disabled).toBe(true);
        expect((screen.getByTestId("order-submit") as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId("chip-bid") as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId("nudge-up") as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId("qty-preset-100") as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(screen.getByTestId("order-submit"));
        expect(onSubmit).not.toHaveBeenCalled();
    });
});

describe("<OrderEntry /> reference chips (P7-7)", () => {
    it("populates exactly the current best bid / mid / ask in cents", () => {
        render(<OrderEntry onSubmit={vi.fn()} bestBidCents={15000} bestAskCents={15025} />);

        fireEvent.click(screen.getByTestId("chip-bid"));
        expect(price().value).toBe("150.00"); // exact best bid

        fireEvent.click(screen.getByTestId("chip-ask"));
        expect(price().value).toBe("150.25"); // exact best ask

        fireEvent.click(screen.getByTestId("chip-mid"));
        expect(price().value).toBe("150.13"); // half-cent mid 15012.5 rounded up to 15013
    });

    it("submits the exact chip cents through validation and onSubmit", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} bestBidCents={15000} bestAskCents={15050} />);

        fireEvent.change(qty(), { target: { value: "10" } });
        fireEvent.click(screen.getByTestId("chip-mid")); // even sum -> exact 15025
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(onSubmit).toHaveBeenCalledWith("BUY", 15025, 10);
    });

    it("disables a chip when its side is absent, and all chips with no book", () => {
        const { rerender } = render(<OrderEntry onSubmit={vi.fn()} bestBidCents={15000} bestAskCents={-1} />);
        expect((screen.getByTestId("chip-bid") as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByTestId("chip-ask") as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId("chip-mid") as HTMLButtonElement).disabled).toBe(true);

        rerender(<OrderEntry onSubmit={vi.fn()} />);
        expect((screen.getByTestId("chip-bid") as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId("chip-ask") as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId("chip-mid") as HTMLButtonElement).disabled).toBe(true);
    });
});

describe("<OrderEntry /> tick nudges (P7-7)", () => {
    it("nudges the price up and down by one cent", () => {
        render(<OrderEntry onSubmit={vi.fn()} />);
        fireEvent.change(price(), { target: { value: "150.00" } });

        fireEvent.click(screen.getByTestId("nudge-up"));
        expect(price().value).toBe("150.01");

        fireEvent.click(screen.getByTestId("nudge-down"));
        fireEvent.click(screen.getByTestId("nudge-down"));
        expect(price().value).toBe("149.99");
    });

    it("never produces a non-positive price, clamping at one cent", () => {
        render(<OrderEntry onSubmit={vi.fn()} />);
        fireEvent.change(price(), { target: { value: "0.01" } });
        fireEvent.click(screen.getByTestId("nudge-down"));
        expect(price().value).toBe("0.01"); // floored, never 0 or negative
    });

    it("is a no-op when the price field is empty or invalid", () => {
        render(<OrderEntry onSubmit={vi.fn()} />);

        fireEvent.click(screen.getByTestId("nudge-up"));
        expect(price().value).toBe(""); // empty stays empty

        fireEvent.change(price(), { target: { value: "abc" } });
        fireEvent.click(screen.getByTestId("nudge-up"));
        expect(price().value).toBe("abc"); // invalid untouched
    });
});

describe("<OrderEntry /> quantity presets (P7-7)", () => {
    it("fills the quantity when the field is empty", () => {
        render(<OrderEntry onSubmit={vi.fn()} />);
        fireEvent.click(screen.getByTestId("qty-preset-100"));
        expect(qty().value).toBe("100");
    });

    it("does not clobber a typed quantity", () => {
        render(<OrderEntry onSubmit={vi.fn()} />);
        fireEvent.change(qty(), { target: { value: "7" } });
        fireEvent.click(screen.getByTestId("qty-preset-500"));
        expect(qty().value).toBe("7");
    });
});

describe("<OrderEntry /> clOrdId field and price seam (P7-7)", () => {
    it("shows the client-assigned id the next NEW will use", () => {
        render(<OrderEntry onSubmit={vi.fn()} clOrdIdPreview={1757000000123} />);
        expect(screen.getByTestId("order-entry-clordid-value").textContent).toBe("1757000000123");
    });

    it("exposes an imperative setPrice that populates the input (the seam the curve feeds)", () => {
        const ref = createRef<OrderEntryHandle>();
        render(<OrderEntry ref={ref} onSubmit={vi.fn()} />);

        act(() => ref.current!.setPrice(15025));
        expect(price().value).toBe("150.25");
    });
});