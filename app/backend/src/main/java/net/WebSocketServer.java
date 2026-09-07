package net;

import com.fasterxml.jackson.databind.ObjectMapper;
import gateway.OrderGateway;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelPipeline;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.MultiThreadIoEventLoopGroup;
import io.netty.channel.group.ChannelGroup;
import io.netty.channel.group.DefaultChannelGroup;
import io.netty.channel.nio.NioIoHandler;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import io.netty.util.concurrent.GlobalEventExecutor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetSocketAddress;

/**
 * Netty WebSocket server (SRS §3.6). Exposes {@code /ws}, registers handshaken clients in a
 * shared {@link ChannelGroup}, and feeds inbound manual orders to the FIX gateway (P4-5).
 *
 * <p><b>Single-writer invariant (decision 2).</b> The worker group is <b>one thread</b>, so every
 * {@code onFrame} publish happens on one thread and the inbound Disruptor stays
 * {@code ProducerType.SINGLE} (§5.2). Do not widen the worker group.
 *
 * <p>{@code ws://}, no TLS (§3.6). One shared {@link ObjectMapper} — only ever touched by the
 * single worker thread.
 */
public final class WebSocketServer {

    private static final Logger log = LoggerFactory.getLogger(WebSocketServer.class);

    private static final String WEBSOCKET_PATH = "/ws";
    private static final int MAX_HTTP_CONTENT_LENGTH = 64 * 1024;

    private final int port;
    private final OrderGateway gateway;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ChannelGroup channelGroup =
            new DefaultChannelGroup("ws-clients", GlobalEventExecutor.INSTANCE);

    private EventLoopGroup bossGroup;
    private EventLoopGroup workerGroup;
    private Channel serverChannel;

    public WebSocketServer(int port, OrderGateway gateway) {
        this.port = port;
        this.gateway = gateway;
    }

    /** Shared connected-client registry; P4-6's publisher writes execution/book frames to this. */
    public ChannelGroup getChannelGroup() {
        return channelGroup;
    }

    /** The actually-bound port. Useful when constructed with port 0 (ephemeral) in tests. */
    public int boundPort() {
        return ((InetSocketAddress) serverChannel.localAddress()).getPort();
    }

    public void start() throws InterruptedException {
        bossGroup = new MultiThreadIoEventLoopGroup(1, NioIoHandler.newFactory());
        workerGroup = new MultiThreadIoEventLoopGroup(1, NioIoHandler.newFactory()); // single worker

        ServerBootstrap b = new ServerBootstrap();
        b.group(bossGroup, workerGroup)
                .channel(NioServerSocketChannel.class)
                .childHandler(new ChannelInitializer<SocketChannel>() {
                    @Override
                    protected void initChannel(SocketChannel ch) {
                        ChannelPipeline p = ch.pipeline();
                        p.addLast(new HttpServerCodec());
                        p.addLast(new HttpObjectAggregator(MAX_HTTP_CONTENT_LENGTH));
                        p.addLast(new WebSocketServerProtocolHandler(WEBSOCKET_PATH));
                        p.addLast(new WebSocketFrameHandler(channelGroup, gateway, objectMapper));
                    }
                });

        serverChannel = b.bind(port).sync().channel();
        log.info("WebSocket server listening on ws://0.0.0.0:{}{}", boundPort(), WEBSOCKET_PATH);
    }

    public void stop() throws InterruptedException {
        if (serverChannel != null) {
            serverChannel.close().sync();
        }
        channelGroup.close().awaitUninterruptibly();
        if (workerGroup != null) {
            workerGroup.shutdownGracefully();
        }
        if (bossGroup != null) {
            bossGroup.shutdownGracefully();
        }
        log.info("WebSocket server stopped");
    }
}