package event;

/**
 * Mutable, reused carrier for a bounded top-N order book depth snapshot (SRS §3.5 depth
 * feed). Framework-free — no com.lmax, no io.netty. The engine writes into a pre-allocated
 * slot on its own thread (MatchingEngine.snapshotInto); a snapshot Disruptor (P4-2) carries
 * it to the WebSocket publisher and market data service.
 *
 * <p><b>Slot-reuse contract.</b> Only indices {@code [0, bidLevelCount)} and
 * {@code [0, askLevelCount)} are valid after a fill. Entries beyond the level count are
 * stale from a previous snapshot and MUST NOT be read. The counts — not the array
 * contents — are authoritative. This is what keeps the carrier zero-allocation across reuse:
 * snapshotInto never has to clear the array tails.
 *
 * <p>Prices are long cents (SRS §4). Empty sides carry the {@code -1L} sentinel in
 * {@code bestBid}/{@code bestAsk} and a level count of 0.
 */
public final class BookSnapshotEvent {

    /** Maximum depth levels retained per side. Sizes every array below. */
    public static final int MAX_DEPTH_LEVELS = 10;

    /** Bid side, best (highest) first. Valid range: [0, bidLevelCount). */
    public final long[] bidPrices = new long[MAX_DEPTH_LEVELS];
    public final long[] bidQtys   = new long[MAX_DEPTH_LEVELS];

    /** Ask side, best (lowest) first. Valid range: [0, askLevelCount). */
    public final long[] askPrices = new long[MAX_DEPTH_LEVELS];
    public final long[] askQtys   = new long[MAX_DEPTH_LEVELS];

    /** Number of populated levels per side (0..MAX_DEPTH_LEVELS). Authoritative. */
    public int bidLevelCount;
    public int askLevelCount;

    /** Top of book in long cents; -1L when the side is empty. Mirror level [0] when present. */
    public long bestBid;
    public long bestAsk;

    /** Snapshot time, epoch nanos (System.nanoTime), stamped when the book was read. */
    public long timestamp;
}