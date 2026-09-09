import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { OpenOrders } from "../src/components/OpenOrders";
import type { MyOrder, OrderStatus } from "../src/state/reducer";
import type { Side } from "../src/protocol/messages";

afterEach(cleanup);

function makeOrder(
    clOrdId: number,
    status: OrderStatus,
    side: Side = "BUY",
    priceCents = 15000,
    remainingQty = 10,
): MyOrder {
    return { clOrdId, side, priceCents, originalQty: 10, remainingQty, status };
}

describe("<OpenOrders />", () => {
    it("renders one row per order with id, side, dollar price, remaining qty, and status", () => {
        render(<OpenOrders orders={[makeOrder(7, "OPEN", "BUY", 15025, 8)]} onCancel={vi.fn()} />);

        const rows = screen.getAllByTestId("open-orders-row");
        expect(rows).toHaveLength(1);
        const text = rows[0].textContent ?? "";
        expect(text).toContain("7");
        expect(text).toContain("BUY");
        expect(text).toContain("150.25");
        expect(text).toContain("8");
        expect(text).toContain("OPEN");
    });

    it("offers Cancel only on cancellable rows (OPEN, PARTIALLY_FILLED)", () => {
        render(
            <OpenOrders
                orders={[
                    makeOrder(1, "PENDING"),
                    makeOrder(2, "OPEN"),
                    makeOrder(3, "PARTIALLY_FILLED"),
                    makeOrder(4, "FILLED"),
                    makeOrder(5, "CANCELLED"),
                    makeOrder(6, "REJECTED"),
                ]}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.queryByTestId("cancel-1")).toBeNull();
        expect(screen.getByTestId("cancel-2")).not.toBeNull();
        expect(screen.getByTestId("cancel-3")).not.toBeNull();
        expect(screen.queryByTestId("cancel-4")).toBeNull();
        expect(screen.queryByTestId("cancel-5")).toBeNull();
        expect(screen.queryByTestId("cancel-6")).toBeNull();
    });

    it("calls onCancel with the row's own clOrdId (the origClOrdId to cancel)", () => {
        const onCancel = vi.fn();
        render(<OpenOrders orders={[makeOrder(42, "OPEN")]} onCancel={onCancel} />);

        fireEvent.click(screen.getByTestId("cancel-42"));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledWith(42);
    });

    it("renders a clean empty state with no rows", () => {
        render(<OpenOrders orders={[]} onCancel={vi.fn()} />);

        expect(screen.getByTestId("open-orders-empty")).not.toBeNull();
        expect(screen.queryAllByTestId("open-orders-row")).toHaveLength(0);
    });

    it("formats the price via centsToDollars and never leaks a sentinel", () => {
        render(<OpenOrders orders={[makeOrder(9, "OPEN", "SELL", 5, 1)]} onCancel={vi.fn()} />);

        const priceCell = screen.getByTestId("open-orders-row").querySelector(".open-orders__price");
        expect(priceCell?.textContent).toBe("0.05");
    });
});