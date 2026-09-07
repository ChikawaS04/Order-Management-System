package net;

import event.CapturingOrderHandler;
import event.InboundPipeline;
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
import io.netty.handler.codec.http.websocketx.WebSocketClientHandshakerFactory;
import io.netty.handler.codec.http.websocketx.WebSocketClientProtocolHandler;
import io.netty.handler.codec.http.websocketx.WebSocketFrame;
import io.netty.handler.codec.http.websocketx.WebSocketVersion;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/** Real loopback proof: server binds, a real Netty WS client handshakes, the server registers
 *  then drops the client in its ChannelGroup. */
class WebSocketServerTest {

    private InboundPipeline pipeline;
    private WebSocketServer server;

    @BeforeEach
    void startServer() throws InterruptedException {
        pipeline = new InboundPipeline(new CapturingOrderHandler());
        pipeline.start();
        OrderGateway gateway = new OrderGateway(pipeline.getRingBuffer());
        server = new WebSocketServer(0, gateway); // ephemeral port
        server.start();
    }

    @AfterEach
    void stopServer() throws InterruptedException {
        if (server != null) {
            server.stop();
        }
        if (pipeline != null) {
            pipeline.shutdown();
        }
    }

    @Test
    void clientHandshakeJoinsAndLeavesChannelGroup() throws Exception {
        EventLoopGroup clientGroup = new MultiThreadIoEventLoopGroup(1, NioIoHandler.newFactory());
        CountDownLatch handshakeDone = new CountDownLatch(1);
        try {
            URI uri = URI.create("ws://127.0.0.1:" + server.boundPort() + "/ws");

            Bootstrap b = new Bootstrap();
            b.group(clientGroup)
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
                                    // no server->client frames in this test
                                }
                            });
                        }
                    });

            Channel clientChannel = b.connect(uri.getHost(), server.boundPort()).sync().channel();

            assertTrue(handshakeDone.await(5, TimeUnit.SECONDS), "client handshake should complete");
            assertTrue(awaitGroupSize(1, 2000), "server should register the connected client");

            clientChannel.close().sync();
            assertTrue(awaitGroupSize(0, 2000), "server should drop the client on disconnect");
        } finally {
            clientGroup.shutdownGracefully();
        }
    }

    private boolean awaitGroupSize(int expected, long timeoutMillis) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
        while (System.nanoTime() < deadline) {
            if (server.getChannelGroup().size() == expected) {
                return true;
            }
            Thread.sleep(10);
        }
        return server.getChannelGroup().size() == expected;
    }
}