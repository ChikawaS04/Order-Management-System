package net;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import engine.MatchingEngine;
import engine.MatchingEngineHandler;
import event.InboundPipeline;
import event.OutboundPipeline;
import event.SnapshotPipeline;
import gateway.OrderGateway;
import io.netty.bootstrap.Bootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.MultiThreadIoEventLoopGroup;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.nio.NioIoHandler;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioSocketChannel;
import io.netty.handler.codec.http.DefaultHttpHeaders;
import io.netty.handler.codec.http.HttpClientCodec;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketClientHandshakerFactory;
import io.netty.handler.codec.http.websocketx.WebSocketClientProtocolHandler;
import io.netty.handler.codec.http.websocketx.WebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketVersion;
import market.MarketDataService;
import publisher.TradeLogger;
import publisher.WebSocketPublisher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * P4-8 — SRS §6.2 WebSocket round-trip. A real Netty WS client connects to the fully
 * assembled server (built in {@code @BeforeEach} on an ephemeral port, mirroring Main's
 * wiring order), submits orders as JSON, and asserts the EXEC/BOOK JSON pushed back.
 *
 * <p>Two properties of the running system dictate the test design:
 * <ul>
 *   <li><b>EXEC and BOOK are independent consumers</b> (separate sequence counters, §3.4)
 *       and interleave unpredictably — a BOOK can be written before an EXEC with an earlier
 *       timestamp. So {@link LoopbackClient#awaitFrame} never assumes "frame N is the fill":
 *       it matches on a parsed predicate and, crucially, does <b>not discard</b> non-matching
 *       frames — each stage asserts on both an EXEC and a BOOK, so a BOOK seen while waiting
 *       for its EXEC must survive for the next await. Matched frames are removed so no frame
 *       is matched twice; the expected book <i>shape</i> is folded into the predicate so a
 *       stale {@code [[15000,10]]} never satisfies a {@code [[15000,6]]} await.</li>
 *   <li><b>Four-plus daemon-thread hops</b> (client loop → server worker → inbound ring →
 *       engine → outbound/snapshot rings → publisher → client loop). Every assertion is a
 *       bounded await (2s ceiling, fast path returns immediately); no {@code Thread.sleep}
 *       is used as a synchronisation primitive. The sole poll is the group-registration
 *       precondition below, which is a membership gate, not an assertion sync.</li>
 * </ul>
 *
 * <p><b>Order ids vs. trade ids.</b> Every {@code orderId} / {@code aggressorOrderId} /
 * {@code passiveOrderId} asserted here is a <i>client-owned</i> {@code ClOrdID} echoed back
 * from the JSON this test sends, so those are deterministic. {@code tradeId}, by contrast, is
 * minted by the static {@code IdGenerator} {@code AtomicLong}, which is <b>global to the
 * JVM</b> — Surefire runs the whole suite in one JVM, so earlier test classes have already
 * advanced that counter and the first trade here is not id 1. Assert the trade id's
 * <i>properties</i> (present, positive, not the {@code -1} NA sentinel), never an absolute
 * value.
 *
 * <p>The client scaffold reuses P4-4's {@code WebSocketServerTest} idiom verbatim
 * (HttpClientCodec → aggregator → {@code WebSocketClientProtocolHandler} with a
 * {@code HANDSHAKE_COMPLETE} latch), extended with a text-frame sink and matchers.
 */
class WebSocketRoundTripTest {

    private static final String ASML = "ASML";
    private static final long PX = 15000L;                 // $150.00 in cents
    private static final long[][] NONE = new long[0][];    // empty side
    private static final long NA = -1L;                    // absent-field sentinel

    private MatchingEngine engine;
    private OutboundPipeline outbound;
    private SnapshotPipeline snapshots;
    private InboundPipeline inbound;
    private WebSocketServer server;
    private LoopbackClient client;

    /**
     * Full pipeline in Main's load-bearing order, on an ephemeral port. Then connect a client
     * and wait until the server has registered it in the ChannelGroup — otherwise the very
     * first snapshot could be published while the group is still empty and
     * {@code WebSocketPublisher}'s empty-group early-out would silently drop that BOOK frame.
     */
    @BeforeEach
    void setUp() throws Exception {
        engine = new MatchingEngine();
        outbound = new OutboundPipeline();
        snapshots = new SnapshotPipeline();

        MatchingEngineHandler handler =
                new MatchingEngineHandler(engine, outbound.getRingBuffer(), snapshots.getRingBuffer());
        engine.setExecutionListener(handler);   // silent-failure trap if omitted: no EXEC ever

        inbound = new InboundPipeline(handler);
        OrderGateway gateway = new OrderGateway(inbound.getRingBuffer());

        server = new WebSocketServer(0, gateway);                 // owns the ChannelGroup
        WebSocketPublisher publisher = new WebSocketPublisher(server.getChannelGroup());

        // Register the two publisher roles on their respective rings, plus the console
        // subscribers, before starting any pipeline.
        outbound.handleEventsWith(publisher.executionHandler(), new TradeLogger());
        snapshots.handleEventsWith(publisher.snapshotHandler(), new MarketDataService());

        // Outbound rings must be live before inbound can publish into the engine.
        outbound.start();
        snapshots.start();
        inbound.start();
        server.start();

        client = new LoopbackClient();
        client.connect(server.boundPort());
        assertTrue(awaitGroupSize(1, 2000),
                "server should register the connected client before the test body runs");
    }

    /** Teardown in the strict reverse of setup, client first so no new frames enter. */
    @AfterEach
    void tearDown() throws Exception {
        if (client != null) client.close();
        if (server != null) server.stop();
        if (inbound != null) inbound.shutdown();
        if (snapshots != null) snapshots.shutdown();
        if (outbound != null) outbound.shutdown();
    }

    // ------------------------------------------------------------------ tests

    /**
     * One book walked empty → resting → reduced → empty, asserting the EXEC and BOOK at each
     * stage. Consolidated into a single sequential test because the three stages share book
     * state; splitting them would re-establish the resting book each time for no gain.
     */
    @Test
    void fullRoundTrip_restThenCrossThenCancel() throws Exception {
        // 1) Resting BUY 10 @ 150.00 -> ORDER_ACCEPTED + BOOK carrying the bid level.
        client.send(newOrder(1, "BUY", PX, 10));

        JsonNode accepted = client.awaitFrame(exec("ORDER_ACCEPTED", 1), 2000);
        assertNotNull(accepted, "resting BUY should push an ORDER_ACCEPTED EXEC");
        assertEquals(10, accepted.path("remainingQuantity").asLong());
        assertEquals(PX, accepted.path("price").asLong());
        assertEquals(NA, accepted.path("tradeId").asLong(), "ACCEPTED carries the -1 NA sentinel");

        JsonNode restBook = client.awaitFrame(book(PX, level(PX, 10), NONE), 2000);
        assertNotNull(restBook, "resting BUY should push a BOOK with bids [[15000,10]]");
        assertEquals(NA, restBook.path("bestAsk").asLong(), "no ask side yet");

        // 2) Crossing SELL 4 @ 150.00 -> ORDER_FILLED at the passive price + BOOK reduced to 6.
        client.send(newOrder(2, "SELL", PX, 4));

        JsonNode filled = client.awaitFrame(exec("ORDER_FILLED", 2), 2000);
        assertNotNull(filled, "crossing SELL should push an ORDER_FILLED EXEC");

        // tradeId is IdGenerator-minted and therefore JVM-global (see class javadoc): assert
        // that a real trade id is present, not an absolute value. A full-suite run advances the
        // counter well past 1 before this class executes.
        long tradeId = filled.path("tradeId").asLong();
        assertTrue(tradeId > 0,
                "a fill must carry a real trade id (positive, not the -1 NA sentinel) but was: " + tradeId);

        assertEquals(PX, filled.path("price").asLong(), "fill at the passive resting price");
        assertEquals(4, filled.path("filledQuantity").asLong());
        assertEquals(0, filled.path("remainingQuantity").asLong());
        assertEquals(2, filled.path("aggressorOrderId").asLong());
        assertEquals(1, filled.path("passiveOrderId").asLong());

        JsonNode reducedBook = client.awaitFrame(book(PX, level(PX, 6), NONE), 2000);
        assertNotNull(reducedBook, "after the 4-lot fill the bid level should read 6");

        // 3) Cancel the resting remainder (OrigClOrdID = 1) -> ORDER_CANCELLED + empty book.
        client.send(cancelOrder(3, 1));

        // The handler stamps orderId = OrigClOrdID on the cancel report (verified against
        // MatchingEngineHandler's cancel branch), i.e. the cancelled order's id, not the
        // cancel request's ClOrdID.
        JsonNode cancelled = client.awaitFrame(exec("ORDER_CANCELLED", 1), 2000);
        assertNotNull(cancelled, "cancel should push an ORDER_CANCELLED EXEC for order id 1");

        JsonNode emptyBook = client.awaitFrame(book(-1, NONE, NONE), 2000);
        assertNotNull(emptyBook, "cancelling the only order should empty the book");
        assertEquals(NA, emptyBook.path("bestAsk").asLong());
    }

    /**
     * Negative path: a malformed JSON frame is dropped at the boundary — nothing published —
     * and neither the single worker thread nor the connection dies, proven by a subsequent
     * valid order still round-tripping on the same channel.
     */
    @Test
    void malformedJson_publishesNothing_andConnectionSurvives() throws Exception {
        client.send("{\"type\":\"NEW\", this is not valid json");
        client.assertNoFrame(execOrBook(), 500);   // bounded window; malformed never reaches the engine

        // Same connection, a well-formed order still works end to end.
        client.send(newOrder(10, "BUY", PX, 5));

        JsonNode accepted = client.awaitFrame(exec("ORDER_ACCEPTED", 10), 2000);
        assertNotNull(accepted, "a valid order after a malformed one should still be accepted");
        assertEquals(5, accepted.path("remainingQuantity").asLong());

        JsonNode validBook = client.awaitFrame(book(PX, level(PX, 5), NONE), 2000);
        assertNotNull(validBook, "the valid order should still push a BOOK frame");
    }

    // ------------------------------------------------------------ JSON builders

    private static String newOrder(long clOrdId, String side, long priceCents, long qty) {
        return "{\"type\":\"NEW\",\"clOrdId\":" + clOrdId + ",\"side\":\"" + side + "\",\"price\":"
                + priceCents + ",\"qty\":" + qty + ",\"symbol\":\"" + ASML + "\"}";
    }

    private static String cancelOrder(long clOrdId, long origClOrdId) {
        return "{\"type\":\"CANCEL\",\"clOrdId\":" + clOrdId + ",\"origClOrdId\":" + origClOrdId + "}";
    }

    // ------------------------------------------------------------ frame predicates

    private static Predicate<JsonNode> exec(String execType, long orderId) {
        return n -> "EXEC".equals(n.path("type").asText())
                && execType.equals(n.path("execType").asText())
                && n.path("orderId").asLong() == orderId;
    }

    private static Predicate<JsonNode> execOrBook() {
        return n -> {
            String t = n.path("type").asText();
            return "EXEC".equals(t) || "BOOK".equals(t);
        };
    }

    private static Predicate<JsonNode> book(long bestBid, long[][] bids, long[][] asks) {
        return n -> "BOOK".equals(n.path("type").asText())
                && n.path("bestBid").asLong() == bestBid
                && levelsMatch(n.path("bids"), bids)
                && levelsMatch(n.path("asks"), asks);
    }

    private static boolean levelsMatch(JsonNode arr, long[][] expected) {
        if (arr == null || !arr.isArray() || arr.size() != expected.length) return false;
        for (int i = 0; i < expected.length; i++) {
            JsonNode lvl = arr.get(i);
            if (lvl.get(0).asLong() != expected[i][0] || lvl.get(1).asLong() != expected[i][1]) {
                return false;
            }
        }
        return true;
    }

    private static long[][] level(long price, long qty) {
        return new long[][]{{price, qty}};
    }

    // ------------------------------------------------------------ group-registration gate

    /** Bounded poll on the server-side ChannelGroup membership. Reuses the P4-4 idiom; this is
     *  a precondition gate (membership updates on the server loop), not an assertion sync. */
    private boolean awaitGroupSize(int expected, long timeoutMillis) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
        while (System.nanoTime() < deadline) {
            if (server.getChannelGroup().size() == expected) return true;
            Thread.sleep(10);
        }
        return server.getChannelGroup().size() == expected;
    }

    // ------------------------------------------------------------ loopback client

    /**
     * A real Netty WS loopback client extending the P4-4 scaffold with a text-frame sink and
     * interleaving-tolerant matchers. The Netty client thread only ever appends raw frame text
     * to {@link #incoming}; all parsing and matching happens on the test thread.
     */
    private static final class LoopbackClient {

        private final EventLoopGroup group = new MultiThreadIoEventLoopGroup(1, NioIoHandler.newFactory());
        private final ObjectMapper mapper = new ObjectMapper();

        /** Handoff from the client event loop to the test thread. */
        private final BlockingQueue<String> incoming = new LinkedBlockingQueue<>();
        /** Parsed-but-not-yet-matched frames; test-thread only. */
        private final List<JsonNode> received = new ArrayList<>();

        private Channel channel;

        void connect(int port) throws Exception {
            CountDownLatch handshakeDone = new CountDownLatch(1);
            URI uri = URI.create("ws://127.0.0.1:" + port + "/ws");

            Bootstrap b = new Bootstrap();
            b.group(group)
                    .channel(NioSocketChannel.class)
                    .handler(new ChannelInitializer<SocketChannel>() {
                        @Override
                        protected void initChannel(SocketChannel ch) {
                            ch.pipeline().addLast(new HttpClientCodec());
                            ch.pipeline().addLast(new HttpObjectAggregator(64 * 1024));
                            ch.pipeline().addLast(new WebSocketClientProtocolHandler(
                                    WebSocketClientHandshakerFactory.newHandshaker(
                                            uri, WebSocketVersion.V13, null, false,
                                            new DefaultHttpHeaders())));
                            ch.pipeline().addLast(new SimpleChannelInboundHandler<WebSocketFrame>() {
                                @Override
                                public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
                                    if (evt == WebSocketClientProtocolHandler
                                            .ClientHandshakeStateEvent.HANDSHAKE_COMPLETE) {
                                        handshakeDone.countDown();
                                    }
                                }

                                @Override
                                protected void channelRead0(ChannelHandlerContext ctx, WebSocketFrame frame) {
                                    if (frame instanceof TextWebSocketFrame text) {
                                        incoming.add(text.text());
                                    }
                                }
                            });
                        }
                    });

            channel = b.connect(uri.getHost(), port).sync().channel();
            assertTrue(handshakeDone.await(5, TimeUnit.SECONDS), "client handshake should complete");
        }

        void send(String json) {
            channel.writeAndFlush(new TextWebSocketFrame(json));   // marshalled onto the client loop
        }

        /**
         * Return the first frame satisfying {@code cond} within the timeout, removing it so it
         * cannot be matched again. Non-matching frames are retained for later awaits. Returns
         * {@code null} on timeout.
         */
        JsonNode awaitFrame(Predicate<JsonNode> cond, long timeoutMillis) throws Exception {
            long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
            while (true) {
                for (int i = 0; i < received.size(); i++) {
                    if (cond.test(received.get(i))) {
                        return received.remove(i);
                    }
                }
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) return null;
                String text = incoming.poll(remaining, TimeUnit.NANOSECONDS);
                if (text != null) received.add(mapper.readTree(text));
            }
        }

        /** Assert no frame satisfying {@code cond} arrives within the window. */
        void assertNoFrame(Predicate<JsonNode> cond, long windowMillis) throws Exception {
            JsonNode hit = awaitFrame(cond, windowMillis);
            assertNull(hit, "expected no matching frame but received: " + hit);
        }

        void close() throws Exception {
            if (channel != null) channel.close().sync();
            group.shutdownGracefully();
        }
    }
}