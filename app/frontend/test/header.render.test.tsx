import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Header } from "../src/components/Header";
import type { HeaderProps } from "../src/components/Header";
import type { BookState, TapeEntry } from "../src/state/reducer";

// P5-0's no-globals stance means RTL's auto-cleanup never registers; wire it
// explicitly so renders don't bleed across tests.
afterEach(cleanup);

const BOOK: BookState = {
    bestBid: 15000,
    bestAsk: 15025,
    bids: [[15000, 10]],
    asks: [[15025, 7]],
    timestamp: 111,
};

const TAPE: TapeEntry[] = [
    { tradeId: 1, priceCents: 15025, quantity: 4, aggressorOrderId: 2, passiveOrderId: 1, timestamp: 222, mine: true },
];

function renderHeader(over: Partial<HeaderProps> = {}) {
    const props: HeaderProps = {
        book: BOOK,
        tape: TAPE,
        sessionVolume: 40,
        sessionOpenCents: 15000,
        msgSeqNum: 7,
        lastFrameNanos: 1_700_000_000_123_456_789,
        connection: "open",
        ...over,
    };
    return render(<Header {...props} />);
}

describe("<Header /> instrument row", () => {
    it("renders the ticker and the derived quote fields", () => {
        renderHeader();
        expect(screen.getByText("ASML")).not.toBeNull();
        expect(screen.getByTestId("header-last").textContent).toBe("150.25");
        expect(screen.getByTestId("header-bid").textContent).toBe("150.00");
        expect(screen.getByTestId("header-ask").textContent).toBe("150.25");
        expect(screen.getByTestId("header-mid").textContent).toBe("150.125");
        expect(screen.getByTestId("header-volume").textContent).toBe("40");
    });

    it("shows the spread in cents and basis points", () => {
        renderHeader();
        expect(screen.getByTestId("header-spread-cents").textContent).toContain("25");
        expect(screen.getByTestId("header-spread-bps").textContent).toContain("16.65"); // 20000*25/30025
    });

    it("colours a positive session change up and shows the signed percent", () => {
        renderHeader();
        const change = screen.getByTestId("header-change");
        expect(change.textContent).toContain("+0.25");
        expect(change.className).toContain("header__value--up");
        expect(screen.getByTestId("header-change-pct").textContent).toBe("+0.17%");
    });
});

describe("<Header /> session row", () => {
    it("reuses the connection badge", () => {
        renderHeader({ connection: "open" });
        const badge = screen.getByTestId("connection-badge");
        expect(badge.textContent).toContain("Live");
    });

    it("labels the FIX session identity client-assigned and never as server data", () => {
        renderHeader({ msgSeqNum: 7 });
        const id = screen.getByTestId("header-session-id");
        expect(id.textContent).toContain("client-assigned");
        expect(screen.getByTestId("header-sender").textContent).toBe("OMS-UI");
        expect(screen.getByTestId("header-target").textContent).toBe("OMS-ENGINE");
        expect(screen.getByTestId("header-seqnum").textContent).toBe("7");
    });

    it("renders the last-frame time as a wall-clock string", () => {
        renderHeader();
        expect(screen.getByTestId("header-last-frame").textContent).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    });
});