package publisher;

import com.lmax.disruptor.EventHandler;
import event.ExecutionEvent;
import event.ExecutionEventType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.Consumer;

/**
 * Server-side trade tape (SRS §3.5): an independent consumer on the outbound ring that logs
 * fills — and only fills — as they are dispatched. {@code ORDER_ACCEPTED}, {@code CANCELLED},
 * and {@code REJECTED} are ignored. Boundary logging only (SRS §5.4); allocation here is fine
 * because it is past the outbound ring (SRS §5.1).
 *
 * <p>The actual emit is behind a {@link Consumer} sink so emissions can be observed in tests
 * without a logging framework — mirroring the injectable-seam idiom already used for the
 * engine clock and {@code ExecutionListener}. The default sink logs via SLF4J
 * (slf4j-simple → console; route to a file via logging config if desired).
 */
public final class TradeLogger implements EventHandler<ExecutionEvent> {

    private static final Logger log = LoggerFactory.getLogger(TradeLogger.class);

    private final Consumer<ExecutionEvent> sink;

    public TradeLogger() {
        this(TradeLogger::logTrade);
    }

    /** Package-private seam for tests: observe emitted fills without asserting on log output. */
    TradeLogger(Consumer<ExecutionEvent> sink) {
        this.sink = sink;
    }

    @Override
    public void onEvent(ExecutionEvent event, long sequence, boolean endOfBatch) {
        ExecutionEventType type = event.eventType;
        if (type == ExecutionEventType.ORDER_FILLED
                || type == ExecutionEventType.ORDER_PARTIALLY_FILLED) {
            sink.accept(event); // reused slot — the sink must read/copy immediately, never retain
        }
    }

    private static void logTrade(ExecutionEvent e) {
        log.info("TRADE {} tradeId={} price={} qty={} remaining={} aggressor={} passive={} ts={}",
                e.eventType, e.tradeId, e.price, e.filledQuantity,
                e.remainingQuantity, e.aggressorOrderId, e.passiveOrderId, e.timestamp);
    }
}