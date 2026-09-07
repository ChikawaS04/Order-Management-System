package event;

import com.lmax.disruptor.BlockingWaitStrategy;
import com.lmax.disruptor.EventHandler;
import com.lmax.disruptor.RingBuffer;
import com.lmax.disruptor.dsl.Disruptor;
import com.lmax.disruptor.dsl.ProducerType;
import com.lmax.disruptor.util.DaemonThreadFactory;

/**
 * Outbound Disruptor wiring (SRS §3.4): single producer (the matching-engine
 * adapter), multiple independent consumers each with its own sequence counter.
 * Adding a subscriber is handleEventsWith(...) — no engine change.
 *
 * BlockingWaitStrategy is a demo default (revisit under JMH). Ring size 1024
 * matches the inbound side.
 */
public final class OutboundPipeline {

    private static final int RING_SIZE = 1024;

    private final Disruptor<ExecutionEvent> disruptor;
    private final RingBuffer<ExecutionEvent> ringBuffer;

    public OutboundPipeline() {
        disruptor = new Disruptor<>(
                new ExecutionEventFactory(),
                RING_SIZE,
                DaemonThreadFactory.INSTANCE,
                ProducerType.SINGLE,
                new BlockingWaitStrategy()
        );
        ringBuffer = disruptor.getRingBuffer();
    }

    /** Register one or more independent subscribers (each gets its own sequence). */
    @SafeVarargs
    public final void handleEventsWith(EventHandler<ExecutionEvent>... handlers) {
        disruptor.handleEventsWith(handlers);
    }

    public void start() {
        disruptor.start();
    }

    public RingBuffer<ExecutionEvent> getRingBuffer() {
        return ringBuffer;
    }

    public void shutdown() {
        disruptor.shutdown();
    }
}