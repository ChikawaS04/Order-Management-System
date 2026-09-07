/**
 * Single-screen trading terminal (SRS §3.7). Assembles the five components
 * around exactly one `useOrderBook` instance and is the sole place `nextClOrdId`
 * and the frame encoders are called — keeping clOrdId generated in one place and
 * never derived from server data.
 *
 * The `SENT` dispatch inside `send` is what registers a `PENDING` open-orders
 * row, so wiring `onSubmit -> send(newOrderFrame(...))` needs no extra
 * bookkeeping. Order entry is gated on an open socket: `send` already no-ops
 * when the socket isn't OPEN, and the badge + disabled entry make that visible
 * (the server gives no reject feedback).
 */

import { useOrderBook } from "./state/useOrderBook";
import { cancelOrderFrame, newOrderFrame, nextClOrdId } from "./protocol/encode";
import type { Side } from "./protocol/messages";

import { Header } from "./components/Header";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { DepthLadder } from "./components/DepthLadder";
import { TradeTape } from "./components/TradeTape";
import { OrderEntry } from "./components/OrderEntry";
import { OpenOrders } from "./components/OpenOrders";

import "./styles/terminal.css";

export default function App() {
    const { state, send } = useOrderBook();
    const connected = state.connection === "open";

    const handleSubmit = (side: Side, priceCents: number, qty: number): void => {
        send(newOrderFrame(nextClOrdId(), side, priceCents, qty));
    };

    const handleCancel = (origClOrdId: number): void => {
        send(cancelOrderFrame(nextClOrdId(), origClOrdId));
    };

    return (
        <div className="app">
            <header className="topbar">
                <Header book={state.book} />
                <ConnectionBadge status={state.connection} />
            </header>

            <main className="workspace">
                <section className="panel panel--ladder" aria-label="Order book depth">
                    <h2 className="panel__title">Depth</h2>
                    <DepthLadder book={state.book} />
                </section>

                <section className="panel panel--tape" aria-label="Trade tape">
                    <h2 className="panel__title">Trades</h2>
                    <TradeTape tape={state.tape} />
                </section>

                <section className="panel panel--controls" aria-label="Trading">
                    <h2 className="panel__title">Order entry</h2>
                    <OrderEntry onSubmit={handleSubmit} disabled={!connected} />
                    <h2 className="panel__title panel__title--spaced">Open orders</h2>
                    <OpenOrders orders={state.myOrders} onCancel={handleCancel} />
                </section>
            </main>
        </div>
    );
}