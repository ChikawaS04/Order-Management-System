import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { OrderEntry, validateOrderInput } from "../src/components/OrderEntry";

// P5-0's no-`globals` stance means RTL's auto-cleanup never registers; wire it
// explicitly so renders don't bleed across tests.
afterEach(cleanup);

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

        fireEvent.change(screen.getByTestId("price-input"), { target: { value: "150.25" } });
        fireEvent.change(screen.getByTestId("qty-input"), { target: { value: "10" } });
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith("BUY", 15025, 10);
    });

    it("emits SELL after toggling side", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} />);

        fireEvent.click(screen.getByTestId("side-sell"));
        fireEvent.change(screen.getByTestId("price-input"), { target: { value: "1.00" } });
        fireEvent.change(screen.getByTestId("qty-input"), { target: { value: "2" } });
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(onSubmit).toHaveBeenCalledWith("SELL", 100, 2);
    });

    it("blocks invalid input: shows a reason and does not call onSubmit", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} />);

        fireEvent.change(screen.getByTestId("price-input"), { target: { value: "150.255" } });
        fireEvent.change(screen.getByTestId("qty-input"), { target: { value: "10" } });
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByTestId("order-entry-error").textContent).toMatch(/price/i);
    });

    it("clears price and qty after a successful submit, keeping side", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} />);

        const price = screen.getByTestId("price-input") as HTMLInputElement;
        const qty = screen.getByTestId("qty-input") as HTMLInputElement;
        fireEvent.change(price, { target: { value: "150.00" } });
        fireEvent.change(qty, { target: { value: "5" } });
        fireEvent.click(screen.getByTestId("order-submit"));

        expect(price.value).toBe("");
        expect(qty.value).toBe("");
    });

    it("uses plain click handlers, not an HTML form submit", () => {
        const { container } = render(<OrderEntry onSubmit={vi.fn()} />);
        expect(container.querySelector("form")).toBeNull();
    });

    it("is inert and visibly disabled when the disabled prop is set", () => {
        const onSubmit = vi.fn();
        render(<OrderEntry onSubmit={onSubmit} disabled />);

        expect((screen.getByTestId("price-input") as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId("qty-input") as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId("order-submit") as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(screen.getByTestId("order-submit"));
        expect(onSubmit).not.toHaveBeenCalled();
    });
});