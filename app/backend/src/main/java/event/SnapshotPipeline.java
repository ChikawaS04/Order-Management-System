package event;

import com.lmax.disruptor.BlockingWaitStrategy;
import com.lmax.disruptor.EventHandler;
import com.lmax.disruptor.RingBuffer;
import com.lmax.disruptor.dsl.Disruptor;
import com.lmax.disruptor.dsl.ProducerType;
import com.lmax.disruptor.util.DaemonThreadFactory;

/**
 * Snapshot Disruptor wiring (Phase 4 decision 3): the second outbound buffer,
 * carrying bounded top-N depth snapshots from the matching engine to the depth
 * consumers (WebSocketPublisher BOOK frames, MarketDataService).
 *
 * Single producer — MatchingEngineHandler, the same object on the same thread
 * that produces the execution buffer — so this stays ProducerType.SINGLE and the
 * single-writer principle (SRS §5.2) holds across both outbound rings.
 *
 * Deliberately mirrors OutboundPipeline: same ring size, same wait strategy, same
 * lifecycle surface. BlockingWaitStrategy is a demo default (revisit under JMH).
 */
public final class SnapshotPipeline {

    private static final int RING_SIZE = 1024;

    private final Disruptor<BookSnapshotEvent> disruptor;
    private final RingBuffer<BookSnapshotEvent> ringBuffer;

    public SnapshotPipeline() {
        disruptor = new Disruptor<>(
                new BookSnapshotEventFactory(),
                RING_SIZE,
                DaemonThreadFactory.INSTANCE,
                ProducerType.SINGLE,
                new BlockingWaitStrategy()
        );
        ringBuffer = disruptor.getRingBuffer();
    }

    /** Register one or more independent subscribers (each gets its own sequence). */
    @SafeVarargs
    public final void handleEventsWith(EventHandler<BookSnapshotEvent>... handlers) {
        disruptor.handleEventsWith(handlers);
    }

    public void start() {
        disruptor.start();
    }

    public RingBuffer<BookSnapshotEvent> getRingBuffer() {
        return ringBuffer;
    }

    public void shutdown() {
        disruptor.shutdown();
    }
}