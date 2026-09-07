package event;

import com.lmax.disruptor.EventFactory;

/**
 * Pre-allocates the OrderEvent slots that fill the inbound ring buffer.
 *
 * The Disruptor calls newInstance() once per slot at construction time, never
 * again on the hot path. Every slot is an empty (default-initialised) carrier;
 * the gateway writes real values into a reused slot per message (SRS §3.2, §5.1).
 *
 * This class exists so OrderEvent can stay free of any com.lmax import — the
 * framework dependency is isolated here, at the factory boundary.
 */
public final class OrderEventFactory implements EventFactory<OrderEvent> {

    @Override
    public OrderEvent newInstance() {
        return new OrderEvent();
    }
}