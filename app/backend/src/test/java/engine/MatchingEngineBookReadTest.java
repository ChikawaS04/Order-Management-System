package engine;

import model.Order;
import model.Side;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * P4-0 empty-book read guard. getBestBid()/getBestAsk() must return the -1L
 * sentinel on an empty (or one-sided) book instead of throwing from firstKey().
 */
class MatchingEngineBookReadTest {

    private MatchingEngine engine;

    @BeforeEach
    void setUp() {
        engine = new MatchingEngine();
    }

    /** Order helper: as-built ctor arg order is (orderID, timeStamp, side, quantity, price, participantID). */
    private static Order order(long id, Side side, int qty, long priceCents) {
        return new Order(id, System.nanoTime(), side, qty, priceCents, 1L);
    }

    @Test
    void emptyBook_bothSidesReturnSentinel() {
        assertEquals(-1L, engine.getBestBid());
        assertEquals(-1L, engine.getBestAsk());
    }

    @Test
    void afterBidInsert_bestBidSet_askStillSentinel() {
        engine.addOrder(order(1L, Side.BUY, 50, 10000L));   // $100.00

        assertEquals(10000L, engine.getBestBid());
        assertEquals(-1L, engine.getBestAsk());             // ask side still empty — no throw
    }

    @Test
    void afterAskInsert_bestAskSet_bidStillSentinel() {
        engine.addOrder(order(1L, Side.SELL, 50, 10100L));  // $101.00

        assertEquals(10100L, engine.getBestAsk());
        assertEquals(-1L, engine.getBestBid());
    }

    @Test
    void multipleBids_bestBidIsHighest() {
        engine.addOrder(order(1L, Side.BUY, 10, 9900L));
        engine.addOrder(order(2L, Side.BUY, 10, 10000L));
        engine.addOrder(order(3L, Side.BUY, 10, 9800L));

        assertEquals(10000L, engine.getBestBid());
    }

    @Test
    void multipleAsks_bestAskIsLowest() {
        engine.addOrder(order(1L, Side.SELL, 10, 10100L));
        engine.addOrder(order(2L, Side.SELL, 10, 10200L));
        engine.addOrder(order(3L, Side.SELL, 10, 10050L));

        assertEquals(10050L, engine.getBestAsk());
    }

    @Test
    void twoSidedBook_reportsBothTops() {
        engine.addOrder(order(1L, Side.BUY, 10, 10000L));   // best bid $100.00
        engine.addOrder(order(2L, Side.SELL, 10, 10100L));  // best ask $101.00 — no cross

        assertEquals(10000L, engine.getBestBid());
        assertEquals(10100L, engine.getBestAsk());
    }
}