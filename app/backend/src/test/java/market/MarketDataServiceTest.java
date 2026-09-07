package market;

import event.BookSnapshotEvent;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MarketDataServiceTest {

    private static BookSnapshotEvent snap(long bestBid, long bestAsk, long ts) {
        BookSnapshotEvent e = new BookSnapshotEvent();
        e.bestBid = bestBid;
        e.bestAsk = bestAsk;
        e.timestamp = ts;
        return e;
    }

    @Test
    void emptyBeforeAnySnapshot() {
        MarketDataService svc = new MarketDataService();
        assertEquals(-1L, svc.getBestBid());
        assertEquals(-1L, svc.getBestAsk());
        assertEquals(-1L, svc.getSpread());
        assertEquals(-1L, svc.getMidpoint());
        assertEquals(-1L, svc.getMidpointHalfCents());
    }

    @Test
    void twoSidedEvenMidpoint() {
        MarketDataService svc = new MarketDataService();
        svc.onEvent(snap(15000L, 15010L, 111L), 0L, true);

        assertEquals(15000L, svc.getBestBid());
        assertEquals(15010L, svc.getBestAsk());
        assertEquals(10L, svc.getSpread());
        assertEquals(30010L, svc.getMidpointHalfCents()); // exact
        assertEquals(15005L, svc.getMidpoint());          // whole cents
        assertEquals(111L, svc.getQuote().timestamp());
    }

    @Test
    void twoSidedHalfCentMidpointTruncatesButHalfCentsExact() {
        MarketDataService svc = new MarketDataService();
        svc.onEvent(snap(15000L, 15005L, 1L), 0L, true);

        assertEquals(5L, svc.getSpread());
        assertEquals(30005L, svc.getMidpointHalfCents()); // exact half-cent
        assertEquals(15002L, svc.getMidpoint());          // 30005 / 2 truncated
    }

    @Test
    void bidOnly() {
        MarketDataService svc = new MarketDataService();
        svc.onEvent(snap(15000L, -1L, 5L), 0L, true);

        assertEquals(15000L, svc.getBestBid());
        assertEquals(-1L, svc.getBestAsk());
        assertEquals(-1L, svc.getSpread());
        assertEquals(-1L, svc.getMidpoint());
        assertEquals(-1L, svc.getMidpointHalfCents());
    }

    @Test
    void askOnly() {
        MarketDataService svc = new MarketDataService();
        svc.onEvent(snap(-1L, 15010L, 5L), 0L, true);

        assertEquals(-1L, svc.getBestBid());
        assertEquals(15010L, svc.getBestAsk());
        assertEquals(-1L, svc.getSpread());
        assertEquals(-1L, svc.getMidpoint());
    }

    @Test
    void latestSnapshotWinsAndEmptyingResetsMetrics() {
        MarketDataService svc = new MarketDataService();

        svc.onEvent(snap(15000L, 15010L, 1L), 0L, true);
        assertEquals(10L, svc.getSpread());

        svc.onEvent(snap(15020L, 15030L, 2L), 1L, true);
        assertEquals(15020L, svc.getBestBid());
        assertEquals(15030L, svc.getBestAsk());
        assertEquals(10L, svc.getSpread());
        assertEquals(2L, svc.getQuote().timestamp());

        // book drains to empty -> metrics must reset, not linger
        svc.onEvent(snap(-1L, -1L, 3L), 2L, true);
        assertEquals(-1L, svc.getBestBid());
        assertEquals(-1L, svc.getBestAsk());
        assertEquals(-1L, svc.getSpread());
        assertEquals(-1L, svc.getMidpoint());
        assertEquals(-1L, svc.getMidpointHalfCents());
    }

    @Test
    void quoteTupleIsSelfConsistent() {
        MarketDataService svc = new MarketDataService();
        svc.onEvent(snap(15000L, 15010L, 42L), 0L, true);

        MarketDataService.Quote q = svc.getQuote();
        assertEquals(15000L, q.bestBid());
        assertEquals(15010L, q.bestAsk());
        assertEquals(10L, q.spread());
        assertEquals(30010L, q.midpointHalfCents());
        assertEquals(42L, q.timestamp());
    }
}