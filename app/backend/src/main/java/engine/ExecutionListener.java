package engine;

/**
 * Framework-free seam the MatchingEngine uses to report executions as they
 * happen. Primitive args only, zero allocation, no com.lmax / io.netty — the
 * engine must not know about the Disruptor. The outbound adapter
 * (MatchingEngineHandler) implements this and turns each callback into an
 * ExecutionEvent on the outbound ring buffer.
 *
 * Cancels are NOT reported here: cancelOrder is a top-level call whose result
 * is returned as a boolean. Only the matching path (fills + the rested
 * acknowledgment), which is buried inside the match loops, needs a callback.
 */
public interface ExecutionListener {

    /**
     * Fired once per trade. aggressorRemainingQuantity is the incoming order's
     * remaining size AFTER this fill (0 means this fill completed it).
     */
    void onFill(long aggressorOrderId, long passiveOrderId, long tradeId,
                long price, long filledQuantity, long aggressorRemainingQuantity);

    /** Fired when an order (or its unfilled remainder) rests on the book. */
    void onAccepted(long orderId, long price, long remainingQuantity);

    /** No-op default so existing callers (Main, prior tests) need no listener. */
    ExecutionListener NO_OP = new ExecutionListener() {
        @Override public void onFill(long a, long p, long t, long pr, long f, long r) { }
        @Override public void onAccepted(long o, long pr, long r) { }
    };
}