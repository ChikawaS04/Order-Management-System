package event;

import com.lmax.disruptor.EventHandler;
import model.Side;

import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Test-only inbound consumer that records what it sees for assertions.
 * Reused by Step 6.5 (round-trip / slot-reuse) and Step 7 ("valid message
 * reaches the ring buffer").
 *
 * Critical contract: onEvent COPIES the fields into an immutable snapshot. It
 * must never retain the OrderEvent reference — the slot is reused, so a later
 * publish would mutate anything we held, and the slot-reuse test would silently
 * pass on stale data.
 *
 * (BlockingQueue is on the project's reject list for the hot path; using one
 * here is fine — this is test scaffolding, off any critical path, and it gives
 * a clean happens-before handoff from the Disruptor thread to the test thread.)
 */
public final class CapturingOrderHandler implements EventHandler<OrderEvent> {

    /** Immutable snapshot of one slot at the instant the consumer saw it. */
    public record Observed(
            OrderEventType eventType,
            long orderId,
            Side side,
            long price,
            long quantity,
            long timestamp,
            long originalOrderId) {}

    private final BlockingQueue<Observed> observed = new LinkedBlockingQueue<>();

    @Override
    public void onEvent(OrderEvent event, long sequence, boolean endOfBatch) {
        observed.add(new Observed(
                event.eventType,
                event.orderId,
                event.side,
                event.price,
                event.quantity,
                event.timestamp,
                event.originalOrderId));
    }

    /** Blocks up to the timeout for the next observed event; null if none arrives. */
    public Observed poll(long timeout, TimeUnit unit) throws InterruptedException {
        return observed.poll(timeout, unit);
    }

    public int count() {
        return observed.size();
    }
}