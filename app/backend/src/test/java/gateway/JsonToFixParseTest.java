package gateway;

import event.OrderEvent;
import event.OrderEventType;
import model.Side;
import net.JsonToFix;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Proves JsonToFix emits FIX 4.2 bytes the real FixParser accepts — correct 9= body length,
 * correct 10= checksum, correct tag/value encoding — by round-tripping through parse().
 */
class JsonToFixParseTest {

    private OrderEvent parseOk(byte[] fix) {
        OrderEvent ev = new OrderEvent();
        assertTrue(new FixParser().parse(fix, 0, fix.length, ev), "FixParser must accept JsonToFix output");
        return ev;
    }

    @Test
    void newOrderRoundTrips() {
        OrderEvent ev = parseOk(JsonToFix.newOrderSingle(7L, Side.BUY, 15025L, 100L, "ASML"));
        assertEquals(OrderEventType.NEW_ORDER, ev.eventType);
        assertEquals(7L, ev.orderId);
        assertEquals(Side.BUY, ev.side);
        assertEquals(15025L, ev.price);
        assertEquals(100L, ev.quantity);
    }

    @Test
    void sellSideEncodesAsTwo() {
        assertEquals(Side.SELL, parseOk(JsonToFix.newOrderSingle(1L, Side.SELL, 10000L, 5L, "ASML")).side);
    }

    @Test
    void cancelRoundTrips() {
        OrderEvent ev = parseOk(JsonToFix.orderCancelRequest(9L, 7L));
        assertEquals(OrderEventType.CANCEL_ORDER, ev.eventType);
        assertEquals(9L, ev.orderId);
        assertEquals(7L, ev.originalOrderId);
    }

    @Test
    void priceWholeDollars() {
        assertEquals(15000L, parseOk(JsonToFix.newOrderSingle(1L, Side.BUY, 15000L, 1L, "ASML")).price);
    }

    @Test
    void priceWithCents() {
        assertEquals(15025L, parseOk(JsonToFix.newOrderSingle(1L, Side.BUY, 15025L, 1L, "ASML")).price);
    }

    @Test
    void priceSubDollar() {
        assertEquals(5L, parseOk(JsonToFix.newOrderSingle(1L, Side.BUY, 5L, 1L, "ASML")).price); // 0.05
    }

    @Test
    void priceExactlyOneDollar() {
        assertEquals(100L, parseOk(JsonToFix.newOrderSingle(1L, Side.BUY, 100L, 1L, "ASML")).price); // 1.00
    }

    @Test
    void wrongSymbolRejectedByParser() {
        byte[] fix = JsonToFix.newOrderSingle(1L, Side.BUY, 15000L, 1L, "MSFT");
        assertFalse(new FixParser().parse(fix, 0, fix.length, new OrderEvent()),
                "parser rejects a symbol that isn't the configured instrument");
    }
}