package net;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gateway.OrderGateway;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.group.ChannelGroup;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import model.Side;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Per-connection tail handler for the WebSocket pipeline. On a completed handshake it registers
 * the channel in the shared {@link ChannelGroup} (P4-4); on a text frame it translates a manual
 * JSON order into FIX bytes and feeds the existing gateway (P4-5).
 *
 * <p>Registration happens on {@link WebSocketServerProtocolHandler.HandshakeComplete}, not
 * channelActive, so a still-upgrading HTTP channel never joins the broadcast group.
 * {@code DefaultChannelGroup} auto-removes on close, so there is no deregistration to maintain.
 *
 * <p>Not {@code @Sharable} — the server initializer creates one per channel.
 */
public class WebSocketFrameHandler extends SimpleChannelInboundHandler<WebSocketFrame> {

    private static final Logger log = LoggerFactory.getLogger(WebSocketFrameHandler.class);

    private final ChannelGroup channelGroup;
    private final OrderGateway gateway;
    private final ObjectMapper objectMapper;

    public WebSocketFrameHandler(ChannelGroup channelGroup, OrderGateway gateway, ObjectMapper objectMapper) {
        this.channelGroup = channelGroup;
        this.gateway = gateway;
        this.objectMapper = objectMapper;
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) throws Exception {
        if (evt instanceof WebSocketServerProtocolHandler.HandshakeComplete) {
            channelGroup.add(ctx.channel());
            log.info("WS client connected: {} ({} total)",
                    ctx.channel().remoteAddress(), channelGroup.size());
        }
        super.userEventTriggered(ctx, evt);
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, WebSocketFrame frame) {
        if (frame instanceof TextWebSocketFrame text) {
            handleOrderJson(text.text());
        }
        // binary/ping/pong/close are handled upstream; ignore anything else here.
    }

    /**
     * Edge translation (§5.5): JSON -> FIX 4.2 bytes -> the existing FIX inbound authority.
     * Runs on the single worker thread, so {@link OrderGateway} stays the single inbound producer
     * (§5.2). FixFrameDecoder is not needed — each WS frame is already exactly one message, so the
     * JsonToFix output goes straight to onFrame. Malformed input is logged and dropped at the
     * boundary (§5.4); onFrame independently logs+drops FIX-invalid frames.
     */
    private void handleOrderJson(String json) {
        try {
            JsonNode node = objectMapper.readTree(json);
            String type = node.path("type").asText();

            byte[] fix;
            if ("NEW".equals(type)) {
                Side side = mapSide(node.path("side").asText(null));
                if (side == null) {
                    log.warn("Dropping NEW order with invalid/missing side: {}", json);
                    return;
                }
                fix = JsonToFix.newOrderSingle(
                        node.get("clOrdId").asLong(),
                        side,
                        node.get("price").asLong(),
                        node.get("qty").asLong(),
                        node.get("symbol").asText());
            } else if ("CANCEL".equals(type)) {
                fix = JsonToFix.orderCancelRequest(
                        node.get("clOrdId").asLong(),
                        node.get("origClOrdId").asLong());
            } else {
                log.warn("Dropping WS frame with unknown type '{}'", type);
                return;
            }

            gateway.onFrame(fix);
        } catch (Exception e) {
            log.warn("Dropping malformed WS order frame: {}", e.toString());
        }
    }

    private static Side mapSide(String s) {
        if ("BUY".equals(s)) return Side.BUY;
        if ("SELL".equals(s)) return Side.SELL;
        return null;
    }
}