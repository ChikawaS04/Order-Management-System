package gateway;

import io.netty.buffer.Unpooled;
import io.netty.channel.embedded.EmbeddedChannel;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class FixFrameDecoderTest {

    private static final byte SOH = 0x01;
    private static final char SOH_C = (char) SOH;

    // --- Message builder -----------------------------------------------------
    // Assembles a full FIX message from body fields (everything from 35=
    // onward, no SOH — added here), prepending 8=FIX.4.2 and a correctly
    // computed BodyLength (tag 9), appending a correct 3-digit CheckSum
    // (tag 10). Correct BodyLength is the point: framing keys entirely off it,
    // so a wrong one would make every "complete" assertion meaningless.
    private static byte[] msg(String... bodyFields) {
        StringBuilder b = new StringBuilder();
        for (String f : bodyFields) b.append(f).append(SOH_C);
        byte[] body = b.toString().getBytes(StandardCharsets.US_ASCII);

        byte[] header = ("8=FIX.4.2" + SOH_C + "9=" + body.length + SOH_C)
                .getBytes(StandardCharsets.US_ASCII);

        int sum = 0;
        for (byte x : header) sum += (x & 0xFF);
        for (byte x : body) sum += (x & 0xFF);
        byte[] trailer = ("10=" + String.format("%03d", sum & 0xFF) + SOH_C)
                .getBytes(StandardCharsets.US_ASCII);

        return concat(header, body, trailer);
    }

    // A realistic NewOrderSingle for ASML, session tags included to prove the
    // framing ignores everything between the length prefix and the trailer.
    private static byte[] validD() {
        return msg("35=D", "49=CLIENT", "56=OMS", "34=2",
                "11=123", "55=ASML", "54=1", "38=100", "44=150.25");
    }

    private static byte[] concat(byte[]... parts) {
        int n = 0;
        for (byte[] p : parts) n += p.length;
        byte[] out = new byte[n];
        int i = 0;
        for (byte[] p : parts) { System.arraycopy(p, 0, out, i, p.length); i += p.length; }
        return out;
    }

    private static byte[] bytes(String s) {
        return s.replace('|', SOH_C).getBytes(StandardCharsets.US_ASCII);
    }

    // =========================================================================
    // frameLength — the pure boundary math
    // =========================================================================
    @Nested
    @DisplayName("frameLength")
    class FrameLength {

        @Test
        @DisplayName("complete message returns its full length")
        void complete() {
            byte[] m = validD();
            assertEquals(m.length, FixFrameDecoder.frameLength(m, 0, m.length));
        }

        @Test
        @DisplayName("honors a non-zero offset within a larger buffer")
        void atOffset() {
            byte[] m = validD();
            byte[] buf = concat(bytes("xxxx"), m); // 4 bytes of lead-in
            assertEquals(m.length, FixFrameDecoder.frameLength(buf, 4, buf.length - 4));
        }

        @Test
        @DisplayName("truncated body -> NEED_MORE")
        void truncated() {
            byte[] m = validD();
            assertEquals(FixFrameDecoder.NEED_MORE,
                    FixFrameDecoder.frameLength(m, 0, m.length - 5));
        }

        @Test
        @DisplayName("no SOH after 8= yet -> NEED_MORE")
        void noFirstSoh() {
            byte[] buf = bytes("8=FIX.4"); // field not terminated
            assertEquals(FixFrameDecoder.NEED_MORE,
                    FixFrameDecoder.frameLength(buf, 0, buf.length));
        }

        @Test
        @DisplayName("does not start with 8= -> MALFORMED")
        void notBeginString() {
            byte[] buf = bytes("9=42|35=D|");
            assertEquals(FixFrameDecoder.MALFORMED,
                    FixFrameDecoder.frameLength(buf, 0, buf.length));
        }

        @Test
        @DisplayName("non-numeric BodyLength -> MALFORMED")
        void nonNumericLength() {
            byte[] buf = bytes("8=FIX.4.2|9=abc|X");
            assertEquals(FixFrameDecoder.MALFORMED,
                    FixFrameDecoder.frameLength(buf, 0, buf.length));
        }

        @Test
        @DisplayName("empty BodyLength -> MALFORMED")
        void emptyLength() {
            byte[] buf = bytes("8=FIX.4.2|9=|X");
            assertEquals(FixFrameDecoder.MALFORMED,
                    FixFrameDecoder.frameLength(buf, 0, buf.length));
        }

        @Test
        @DisplayName("BodyLength beyond MAX_FRAME -> MALFORMED")
        void oversized() {
            byte[] buf = bytes("8=FIX.4.2|9=99999|X"); // 99999 > MAX_FRAME
            assertEquals(FixFrameDecoder.MALFORMED,
                    FixFrameDecoder.frameLength(buf, 0, buf.length));
        }

        @Test
        @DisplayName("trailer not ending in SOH -> MALFORMED")
        void brokenTrailerEnd() {
            byte[] m = validD();
            m[m.length - 1] = 'X'; // corrupt the final SOH
            assertEquals(FixFrameDecoder.MALFORMED,
                    FixFrameDecoder.frameLength(m, 0, m.length));
        }

        @Test
        @DisplayName("trailer not '10=' -> MALFORMED")
        void brokenTrailerTag() {
            byte[] m = validD();
            m[m.length - 7] = '2'; // '1' -> '2', so "20=" instead of "10="
            assertEquals(FixFrameDecoder.MALFORMED,
                    FixFrameDecoder.frameLength(m, 0, m.length));
        }
    }

    // =========================================================================
    // frameAndEmit — the driver loop (the five build-guide stream cases)
    // =========================================================================
    @Nested
    @DisplayName("frameAndEmit")
    class FrameAndEmit {

        private final List<Object> out = new ArrayList<>();

        @Test
        @DisplayName("one clean message")
        void oneClean() {
            byte[] m = validD();
            int consumed = FixFrameDecoder.frameAndEmit(m, 0, m.length, out);
            assertEquals(m.length, consumed);
            assertEquals(1, out.size());
            assertArrayEquals(m, (byte[]) out.get(0));
        }

        @Test
        @DisplayName("two messages back to back")
        void backToBack() {
            byte[] m1 = validD();
            byte[] m2 = msg("35=F", "11=124", "41=123");
            byte[] both = concat(m1, m2);
            int consumed = FixFrameDecoder.frameAndEmit(both, 0, both.length, out);
            assertEquals(both.length, consumed);
            assertEquals(2, out.size());
            assertArrayEquals(m1, (byte[]) out.get(0));
            assertArrayEquals(m2, (byte[]) out.get(1));
        }

        @Test
        @DisplayName("one message split across two chunks")
        void split() {
            byte[] m = validD();
            // First: only 30 bytes have arrived -> nothing framed, nothing consumed.
            int c1 = FixFrameDecoder.frameAndEmit(m, 0, 30, out);
            assertEquals(0, c1);
            assertTrue(out.isEmpty());
            // Then the rest arrives (cumulation now holds the whole message).
            int c2 = FixFrameDecoder.frameAndEmit(m, 0, m.length, out);
            assertEquals(m.length, c2);
            assertEquals(1, out.size());
            assertArrayEquals(m, (byte[]) out.get(0));
        }

        @Test
        @DisplayName("a chunk containing 1.5 messages")
        void oneAndAHalf() {
            byte[] m1 = validD();
            byte[] m2 = validD();
            byte[] buf = concat(m1, Arrays.copyOf(m2, m2.length / 2));
            int consumed = FixFrameDecoder.frameAndEmit(buf, 0, buf.length, out);
            assertEquals(m1.length, consumed); // half of m2 stays for next time
            assertEquals(1, out.size());
            assertArrayEquals(m1, (byte[]) out.get(0));
        }

        @Test
        @DisplayName("garbage before 8=FIX is skipped")
        void garbageBefore() {
            byte[] m = validD();
            byte[] buf = concat(bytes("!!junk!!"), m);
            int consumed = FixFrameDecoder.frameAndEmit(buf, 0, buf.length, out);
            assertEquals(buf.length, consumed);
            assertEquals(1, out.size());
            assertArrayEquals(m, (byte[]) out.get(0));
        }

        @Test
        @DisplayName("malformed prefix resyncs to the next 8=")
        void malformedResync() {
            byte[] bad = bytes("8=FIX.4.2|9=abc|"); // non-numeric length
            byte[] m = validD();
            byte[] buf = concat(bad, m);
            int consumed = FixFrameDecoder.frameAndEmit(buf, 0, buf.length, out);
            assertEquals(buf.length, consumed);
            assertEquals(1, out.size());
            assertArrayEquals(m, (byte[]) out.get(0));
        }

        @Test
        @DisplayName("pure garbage with no 8= is discarded")
        void garbageOnly() {
            byte[] buf = bytes("no markers here");
            int consumed = FixFrameDecoder.frameAndEmit(buf, 0, buf.length, out);
            assertEquals(buf.length, consumed);
            assertTrue(out.isEmpty());
        }
    }

    // =========================================================================
    // Netty wrapper sanity — accumulation through ByteToMessageDecoder
    // =========================================================================
    @Nested
    @DisplayName("EmbeddedChannel wrapper")
    class Wrapper {

        @Test
        @DisplayName("emits a whole message written in one buffer")
        void whole() {
            byte[] m = validD();
            EmbeddedChannel ch = new EmbeddedChannel(new FixFrameDecoder());
            assertTrue(ch.writeInbound(Unpooled.wrappedBuffer(m)));
            byte[] framed = ch.readInbound();
            assertArrayEquals(m, framed);
            assertNull(ch.readInbound());
            ch.finish();
        }

        @Test
        @DisplayName("accumulates a message split across two writes")
        void splitAcrossWrites() {
            byte[] m = validD();
            EmbeddedChannel ch = new EmbeddedChannel(new FixFrameDecoder());

            ch.writeInbound(Unpooled.wrappedBuffer(Arrays.copyOfRange(m, 0, 30)));
            assertNull(ch.readInbound()); // not complete yet

            ch.writeInbound(Unpooled.wrappedBuffer(Arrays.copyOfRange(m, 30, m.length)));
            byte[] framed = ch.readInbound();
            assertArrayEquals(m, framed);
            ch.finish();
        }
    }
}