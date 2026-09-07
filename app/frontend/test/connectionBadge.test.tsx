import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ConnectionBadge } from "../src/components/ConnectionBadge";

// P5-0's no-`globals` stance means RTL's auto-cleanup never registers; wire it
// explicitly so renders don't bleed across tests.
afterEach(cleanup);

describe("<ConnectionBadge />", () => {
    it("shows Live when the socket is open", () => {
        render(<ConnectionBadge status="open" />);
        const badge = screen.getByTestId("connection-badge");
        expect(badge.textContent).toContain("Live");
        expect(badge.className).toContain("badge--live");
    });

    it("shows Connecting on the first connect attempt", () => {
        render(<ConnectionBadge status="connecting" />);
        const badge = screen.getByTestId("connection-badge");
        expect(badge.textContent).toContain("Connecting");
        expect(badge.className).toContain("badge--connecting");
    });

    it("shows Reconnecting as the down state (there is no persistent disconnected)", () => {
        render(<ConnectionBadge status="reconnecting" />);
        const badge = screen.getByTestId("connection-badge");
        expect(badge.textContent).toContain("Reconnecting");
        expect(badge.className).toContain("badge--reconnecting");
    });
});