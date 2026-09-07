/**
 * Connection status pill, driven by the hook's `connection` state.
 *
 * Reconciles the guide's stale "live / reconnecting / disconnected" wording
 * against the real three-member union `"connecting" | "open" | "reconnecting"`:
 * there is NO persistent disconnected state — `useOrderBook` always retries with
 * capped backoff, so "reconnecting" IS the down state. The switch is exhaustive
 * over the closed union (noFallthroughCasesInSwitch + no default).
 */

import type { ConnectionStatus } from "../state/reducer";

interface BadgeView {
    readonly label: string;
    readonly modifier: string;
}

function badgeView(status: ConnectionStatus): BadgeView {
    switch (status) {
        case "open":
            return { label: "Live", modifier: "live" };
        case "connecting":
            return { label: "Connecting", modifier: "connecting" };
        case "reconnecting":
            return { label: "Reconnecting", modifier: "reconnecting" };
    }
}

interface ConnectionBadgeProps {
    readonly status: ConnectionStatus;
}

export function ConnectionBadge({ status }: ConnectionBadgeProps) {
    const { label, modifier } = badgeView(status);

    return (
        <div
            className={`badge badge--${modifier}`}
            role="status"
            aria-live="polite"
            data-testid="connection-badge"
        >
            <span className="badge__dot" aria-hidden="true" />
            <span className="badge__label">{label}</span>
        </div>
    );
}