package net;

import com.fasterxml.jackson.databind.ObjectMapper;
import event.CapturingOrderHandler;
import event.InboundPipeline;
import event.OrderEventType;
import gateway.OrderGateway;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.channel.group.ChannelGroup;
import io.netty.channel.group.DefaultChannelGroup;
import io.netty.handler.codec.http.DefaultHttpHeaders;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import io.netty.util.concurrent.GlobalEventExecutor;
import model.Side;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/** Drives the frame handler directly via EmbeddedChannel over a real gateway + inbound ring. */
class WebSocketFrameHandlerTest {

    private static final long TIMEOUT_MS = 2_000;
    private static final long NEG_TIMEOUT_MS = 300; // long enough to prove nothing arrives

    private ChannelGroup group;
    private CapturingOrderHandler captured;
    private InboundPipeline pipeline;
    private EmbeddedChannel channel;

    @BeforeEach
    void setup() {
        group = new DefaultChannelGroup("test", GlobalEventExecutor.INSTANCE);
        captured = new CapturingOrderHandler();
        pipeline = new InboundPipeline(captured);
        pipeline.start();
        OrderGateway gateway = new OrderGateway(pipeline.getRingBuffer());
        channel = new EmbeddedChannel(new WebSocketFrameHandler(group, gateway, new ObjectMapper()));
    }

    @AfterEach
    void tearDown() {
        channel.finishAndReleaseAll();
        pipeline.shutdown();
    }

    // --- membership (carried from P4-4) ---

    @Test
    void addsChannelToGroupOnHandshakeComplete() {
        assertTrue(group.isEmpty());
        channel.pipeline().fireUserEventTriggered(new WebSocketServerProtocolHandler.HandshakeComplete(
                "/ws", new DefaultHttpHeaders(), null));
        assertEquals(1, group.size());
        assertTrue(group.contains(channel));
    }

    @Test
    void ignoresUnrelatedUserEvents() {
        channel.pipeline().fireUserEventTriggered(new Object());
        assertTrue(group.isEmpty());
    }

    // --- inbound JSON -> FIX -> ring (P4-5) ---

    @Test
    void newOrderJsonReachesInboundRing() throws Exception {
        channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"NEW\",\"clOrdId\":7,\"side\":\"BUY\",\"price\":15025,\"qty\":100,\"symbol\":\"ASML\"}"));

        CapturingOrderHandler.Observed obs = captured.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        assertNotNull(obs, "NEW order should reach the inbound ring");
        assertEquals(OrderEventType.NEW_ORDER, obs.eventType());
        assertEquals(7L, obs.orderId());
        assertEquals(Side.BUY, obs.side());
        assertEquals(15025L, obs.price());
        assertEquals(100L, obs.quantity());
    }

    @Test
    void sellOrderMapsToSellSide() throws Exception {
        channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"NEW\",\"clOrdId\":8,\"side\":\"SELL\",\"price\":15000,\"qty\":50,\"symbol\":\"ASML\"}"));
        CapturingOrderHandler.Observed obs = captured.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        assertNotNull(obs);
        assertEquals(Side.SELL, obs.side());
        assertEquals(15000L, obs.price());
    }

    @Test
    void cancelJsonReachesInboundRing() throws Exception {
        channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"CANCEL\",\"clOrdId\":9,\"origClOrdId\":7}"));
        CapturingOrderHandler.Observed obs = captured.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        assertNotNull(obs, "CANCEL should reach the inbound ring");
        assertEquals(OrderEventType.CANCEL_ORDER, obs.eventType());
        assertEquals(9L, obs.orderId());
        assertEquals(7L, obs.originalOrderId());
    }

    @Test
    void malformedJsonPublishesNothing() throws Exception {
        channel.writeInbound(new TextWebSocketFrame("{not valid json"));
        assertNull(captured.poll(NEG_TIMEOUT_MS, TimeUnit.MILLISECONDS), "malformed JSON must not publish");
    }

    @Test
    void unknownTypePublishesNothing() throws Exception {
        channel.writeInbound(new TextWebSocketFrame("{\"type\":\"FOO\",\"clOrdId\":1}"));
        assertNull(captured.poll(NEG_TIMEOUT_MS, TimeUnit.MILLISECONDS));
    }

    @Test
    void invalidSidePublishesNothing() throws Exception {
        channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"NEW\",\"clOrdId\":1,\"side\":\"HOLD\",\"price\":15000,\"qty\":10,\"symbol\":\"ASML\"}"));
        assertNull(captured.poll(NEG_TIMEOUT_MS, TimeUnit.MILLISECONDS), "unknown side dropped at the edge");
    }

    @Test
    void wrongSymbolPublishesNothing() throws Exception {
        // JsonToFix encodes it; the FIX parser rejects the symbol; the gateway logs+drops.
        channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"NEW\",\"clOrdId\":1,\"side\":\"BUY\",\"price\":15000,\"qty\":10,\"symbol\":\"MSFT\"}"));
        assertNull(captured.poll(NEG_TIMEOUT_MS, TimeUnit.MILLISECONDS), "wrong symbol rejected by parser");
    }
}