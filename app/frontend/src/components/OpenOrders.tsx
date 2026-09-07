/**
 * Open-orders panel (SRS §3.7). Presentational and single-slice: renders the
 * reducer's `myOrders` and emits a cancel intent via `onCancel`. It builds no
 * frame and holds no clOrdId generator — App (P5-5) turns `onCancel` into
 * `send(cancelOrderFrame(nextClOrdId(), origClOrdId))`.
 *
 * A Cancel action is offered only on `isCancellable` rows (OPEN /
 * PARTIALLY_FILLED). Status and remaining quantity are authoritative from EXEC
 * only; this component never mutates them. `origClOrdId` for a cancel is the
 * row's own `clOrdId` — the resting order to cancel — and the returning
 * ORDER_CANCELLED echoes that as its `orderId`, closing the row.
 *
 * Prices render through `centsToDollars`; a `-1` would surface as EMPTY_PRICE,
 * never a negative dollar amount (defensive — a live order always carries a
 * real price).
 */

import { isCancellable } from "../state/reducer";
import type { MyOrder } from "../state/reducer";
import { centsToDollars } from "../format";

export interface OpenOrdersProps {
    readonly orders: readonly MyOrder[];
    readonly onCancel: (origClOrdId: number) => void;
}

export function OpenOrders({ orders, onCancel }: OpenOrdersProps) {
    if (orders.length === 0) {
        return (
            <div className="open-orders">
                <div className="open-orders__empty" data-testid="open-orders-empty">
                    No open orders
                </div>
            </div>
        );
    }

    return (
        <div className="open-orders">
            <table className="open-orders__table">
                <thead>
                <tr>
                    <th className="open-orders__col-id">ID</th>
                    <th className="open-orders__col-side">Side</th>
                    <th className="open-orders__col-price">Price</th>
                    <th className="open-orders__col-qty">Rem</th>
                    <th className="open-orders__col-status">Status</th>
                    <th className="open-orders__col-action" aria-label="Actions" />
                </tr>
                </thead>
                <tbody>
                {orders.map((order) => (
                    <tr
                        key={order.clOrdId}
                        className={`open-orders__row open-orders__row--${order.side.toLowerCase()}`}
                        data-testid="open-orders-row"
                    >
                        <td className="open-orders__id">{order.clOrdId}</td>
                        <td className="open-orders__side">{order.side}</td>
                        <td className="open-orders__price">{centsToDollars(order.priceCents)}</td>
                        <td className="open-orders__qty">{order.remainingQty}</td>
                        <td className="open-orders__status">{order.status}</td>
                        <td className="open-orders__action">
                            {isCancellable(order.status) ? (
                                <button
                                    type="button"
                                    className="open-orders__cancel"
                                    data-testid={`cancel-${order.clOrdId}`}
                                    onClick={() => onCancel(order.clOrdId)}
                                >
                                    Cancel
                                </button>
                            ) : null}
                        </td>
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}