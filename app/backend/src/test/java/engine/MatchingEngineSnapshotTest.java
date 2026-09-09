package engine;

import event.BookSnapshotEvent;
import model.Order;
import model.Side;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * P4-1 depth snapshot: MatchingEngine.snapshotInto fills a bounded top-N carrier,
 * best-first, aggregating quantity per level, with -1L sentinels on empty sides.
 */
class MatchingEngineSnapshotTest {

    private MatchingEngine engine;
    private BookSnapshotEvent snap;

    @BeforeEach
    void setUp() {
        engine = new MatchingEngine();
        snap = new BookSnapshotEvent();
    }

    /** As-built ctor arg order: (orderID, timeStamp, side, quantity, price, participantID). */
    private static Order order(long id, Side side, int qty, long priceCents) {
        return new Order(id, System.nanoTime(), side, qty, priceCents, 1L);
    }

    @Test
    void emptyBook_zeroCounts_sentinelTops() {
        engine.snapshotInto(snap, BookSnapshotEvent.MAX_DEPTH_LEVELS);

        assertEquals(0, snap.bidLevelCount);
        assertEquals(0, snap.askLevelCount);
        assertEquals(-1L, snap.bestBid);
        assertEquals(-1L, snap.bestAsk);
    }

    @Test
    void aggregatesQuantityAcrossOrdersAtOneLevel() {
        engine.addOrder(order(1L, Side.BUY, 30, 10000L));
        engine.addOrder(order(2L, Side.BUY, 20, 10000L));   // same price level, FIFO

        engine.snapshotInto(snap, BookSnapshotEvent.MAX_DEPTH_LEVELS);

        assertEquals(1, snap.bidLevelCount);
        assertEquals(10000L, snap.bidPrices[0]);
        assertEquals(50L, snap.bidQtys[0]);                 // 30 + 20 aggregated into one level
        assertEquals(10000L, snap.bestBid);
        assertEquals(0, snap.askLevelCount);
        assertEquals(-1L, snap.bestAsk);
    }

    @Test
    void oneSidedBook_asksEmpty() {
        engine.addOrder(order(1L, Side.BUY, 10, 9900L));
        engine.addOrder(order(2L, Side.BUY, 10, 10000L));

        engine.snapshotInto(snap, BookSnapshotEvent.MAX_DEPTH_LEVELS);

        assertEquals(2, snap.bidLevelCount);
        assertEquals(10000L, snap.bidPrices[0]);            // best (highest) first
        assertEquals(9900L, snap.bidPrices[1]);
        assertEquals(0, snap.askLevelCount);
        assertEquals(-1L, snap.bestAsk);
    }

    @Test
    void bidsHighestFirst_asksLowestFirst() {
        engine.addOrder(order(1L, Side.BUY, 10, 9900L));
        engine.addOrder(order(2L, Side.BUY, 10, 10000L));
        engine.addOrder(order(3L, Side.SELL, 10, 10200L));
        engine.addOrder(order(4L, Side.SELL, 10, 10100L));  // 10100 > 10000 best bid — no cross

        engine.snapshotInto(snap, BookSnapshotEvent.MAX_DEPTH_LEVELS);

        assertEquals(2, snap.bidLevelCount);
        assertEquals(10000L, snap.bidPrices[0]);
        assertEquals(9900L, snap.bidPrices[1]);
        assertEquals(10000L, snap.bestBid);

        assertEquals(2, snap.askLevelCount);
        assertEquals(10100L, snap.askPrices[0]);            // best (lowest) first
        assertEquals(10200L, snap.askPrices[1]);
        assertEquals(10100L, snap.bestAsk);
    }

    @Test
    void moreThanMaxLevels_truncatesToTopN() {
        // 12 distinct bid levels 10000..10011, all buys (no asks, no cross)
        for (int i = 0; i < 12; i++) {
            engine.addOrder(order(i + 1, Side.BUY, 5, 10000L + i));
        }

        engine.snapshotInto(snap, BookSnapshotEvent.MAX_DEPTH_LEVELS);   // capacity 10

        assertEquals(BookSnapshotEvent.MAX_DEPTH_LEVELS, snap.bidLevelCount);
        assertEquals(10011L, snap.bidPrices[0]);            // highest kept
        assertEquals(10002L, snap.bidPrices[9]);            // 10th-highest; 10001 & 10000 dropped
        assertEquals(10011L, snap.bestBid);                 // top of book unaffected by truncation
    }

    @Test
    void maxLevelsArg_clampedToCapacity() {
        for (int i = 0; i < 5; i++) {
            engine.addOrder(order(i + 1, Side.BUY, 5, 10000L + i));
        }

        engine.snapshotInto(snap, 100);                     // caller over-asks; only 5 levels exist

        assertEquals(5, snap.bidLevelCount);
    }

    @Test
    void maxLevelsArg_truncatesBelowCapacity() {
        for (int i = 0; i < 5; i++) {
            engine.addOrder(order(i + 1, Side.BUY, 5, 10000L + i));
        }

        engine.snapshotInto(snap, 3);                       // caller wants only top 3

        assertEquals(3, snap.bidLevelCount);
        assertEquals(10004L, snap.bidPrices[0]);
        assertEquals(10002L, snap.bidPrices[2]);
    }

    @Test
    void slotReuse_countsAuthoritative_noStaleBleed() {
        engine.addOrder(order(1L, Side.BUY, 5, 10000L));
        engine.addOrder(order(2L, Side.BUY, 5, 9900L));
        engine.addOrder(order(3L, Side.BUY, 5, 9800L));
        engine.snapshotInto(snap, BookSnapshotEvent.MAX_DEPTH_LEVELS);
        assertEquals(3, snap.bidLevelCount);

        // Reuse the same carrier against a fresh, smaller book.
        MatchingEngine engine2 = new MatchingEngine();
        engine2.addOrder(order(10L, Side.BUY, 7, 20000L));
        engine2.snapshotInto(snap, BookSnapshotEvent.MAX_DEPTH_LEVELS);

        assertEquals(1, snap.bidLevelCount);                // count shrank — authoritative
        assertEquals(20000L, snap.bidPrices[0]);            // valid prefix overwritten
        assertEquals(7L, snap.bidQtys[0]);
        assertEquals(20000L, snap.bestBid);
        // bidPrices[1] may still hold 9900 from the prior snapshot; that's expected.
        // Consumers read only [0, bidLevelCount) — we assert the contract, not a zeroed tail.
    }

    @Test
    void bestTopsMatchLevelZero() {
        engine.addOrder(order(1L, Side.BUY, 5, 10000L));
        engine.addOrder(order(2L, Side.SELL, 5, 10100L));

        engine.snapshotInto(snap, BookSnapshotEvent.MAX_DEPTH_LEVELS);

        assertEquals(snap.bidPrices[0], snap.bestBid);
        assertEquals(snap.askPrices[0], snap.bestAsk);
    }
}