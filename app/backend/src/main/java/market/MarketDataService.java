package market;

import com.lmax.disruptor.EventHandler;
import event.BookSnapshotEvent;

/**
 * Market data subscriber (SRS §3.5): an independent consumer on the snapshot ring that
 * derives best bid/ask, midpoint, and spread from each {@link BookSnapshotEvent}.
 *
 * <p>Rebuilt for Phase 4. The Phase 1 form pulled best bid/ask from a {@code BookView} on
 * demand; the engine is now the single source of truth (guide decision 3) and hands out
 * bounded depth snapshots, so this is a push consumer instead. Metrics are derived <b>inside
 * {@code onEvent}</b> — the snapshot slot is reused and must not be retained past the call.
 *
 * <p><b>Threading.</b> Written by the snapshot Disruptor's consumer thread; read by any
 * thread. Each snapshot swaps a single immutable {@link Quote} through one {@code volatile}
 * store, so a reader always observes a self-consistent tuple (never bestBid from one snapshot
 * mixed with spread from the next). {@link #getQuote()} is the coherent multi-field read;
 * the individual getters are convenience views over the same volatile load.
 *
 * <p><b>Units.</b> Prices are long cents (SRS §4). Midpoint is stored exactly in half-cents
 * (1 cent = 2 half-cents) because the average of two cent-prices can be a half-cent; whole-cent
 * and exact accessors are both provided. Empty sides carry the {@code -1L} sentinel.
 */
public final class MarketDataService implements EventHandler<BookSnapshotEvent> {

    /** Consistent snapshot of the derived metrics. All fields carry -1L when unavailable. */
    public record Quote(
            long bestBid,           // cents; -1L if bid side empty
            long bestAsk,           // cents; -1L if ask side empty
            long spread,            // cents (bestAsk - bestBid); -1L if either side empty
            long midpointHalfCents, // exact 2x midpoint (bestBid + bestAsk); -1L if either side empty
            long timestamp          // epoch nanos of the snapshot this quote was derived from
    ) {
        static final Quote EMPTY = new Quote(-1L, -1L, -1L, -1L, -1L);
    }

    private volatile Quote quote = Quote.EMPTY;

    @Override
    public void onEvent(BookSnapshotEvent event, long sequence, boolean endOfBatch) {
        long bestBid = event.bestBid;
        long bestAsk = event.bestAsk;

        long spread;
        long midHalfCents;
        if (bestBid == -1L || bestAsk == -1L) {
            spread = -1L;
            midHalfCents = -1L;
        } else {
            spread = bestAsk - bestBid;          // resting book is non-crossed => >= 0
            midHalfCents = bestBid + bestAsk;    // exact 2x midpoint, i.e. midpoint in half-cents
        }

        // One volatile publish of a coherent tuple. Nothing beyond this line touches the slot.
        quote = new Quote(bestBid, bestAsk, spread, midHalfCents, event.timestamp);
    }

    // ---- reads: any thread; one volatile load per call ----

    /** The full, self-consistent latest quote. Prefer this for multi-field reads. */
    public Quote getQuote() {
        return quote;
    }

    public long getBestBid() {
        return quote.bestBid();
    }

    public long getBestAsk() {
        return quote.bestAsk();
    }

    /** Spread in cents, or -1L if either side is empty. */
    public long getSpread() {
        return quote.spread();
    }

    /**
     * Midpoint truncated to whole cents (preserves the Phase 1 contract), or -1L if either
     * side is empty. Use {@link #getMidpointHalfCents()} for the exact value.
     */
    public long getMidpoint() {
        long half = quote.midpointHalfCents();
        return half == -1L ? -1L : half / 2;
    }

    /**
     * Exact midpoint in half-cent units (1 cent = 2 half-cents), or -1L if either side is
     * empty. Divide by 2.0 at the display boundary for the true cents value.
     */
    public long getMidpointHalfCents() {
        return quote.midpointHalfCents();
    }
}