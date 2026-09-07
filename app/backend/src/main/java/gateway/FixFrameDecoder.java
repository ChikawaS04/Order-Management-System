package gateway;

import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageDecoder;

import java.util.Arrays;
import java.util.List;

/**
 * Length-prefixed FIX framing (Step 6). Reads 9=<n>, consumes exactly n body
 * bytes plus the fixed 7-byte trailer 10=xxx<SOH>, and emits one complete
 * message at a time as a byte[] copy.
 *
 * Handoff decision (a): each frame is copied into its own byte[] and handed
 * downstream. The single allocation lands here, upstream of the SRS hot path
 * (which begins at the inbound ring buffer). This keeps FixParser pure byte[]
 * with no Netty refcount discipline leaking into Step 7.
 *
 * The framing math (frameLength) and the driver loop (frameAndEmit) are static
 * and Netty-free so they can be unit-tested on plain byte[].
 */
public final class FixFrameDecoder extends ByteToMessageDecoder {

    // Framing outcomes for frameLength. A real result is the frame length (> 0).
    static final int NEED_MORE = 0;   // incomplete; wait for more bytes
    static final int MALFORMED = -1;  // prefix is a lie; resync to next 8=

    private static final byte B8 = '8';
    private static final byte B9 = '9';
    private static final byte B1 = '1';
    private static final byte B0 = '0';
    private static final byte EQ = FixConstants.EQUALS;
    private static final byte SOH = FixConstants.SOH;
    private static final int TRAILER_LEN = 7; // "10=" + 3 checksum digits + SOH

    // Scratch for the direct-buffer path only (see decode). Grows monotonically;
    // never touched when the cumulation is heap-backed.
    private byte[] scratch = new byte[256];

    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
        int avail = in.readableBytes();
        if (avail < 2) {
            return;
        }

        final byte[] data;
        final int dataOffset;
        if (in.hasArray()) {
            // Zero-copy view into the backing array.
            data = in.array();
            dataOffset = in.arrayOffset() + in.readerIndex();
        } else {
            // Pooled/direct buffer: copy the readable region into scratch.
            if (scratch.length < avail) {
                scratch = new byte[Math.max(avail, scratch.length * 2)];
            }
            in.getBytes(in.readerIndex(), scratch, 0, avail);
            data = scratch;
            dataOffset = 0;
        }

        int consumed = frameAndEmit(data, dataOffset, avail, out);
        if (consumed > 0) {
            in.skipBytes(consumed);
        }
    }

    /**
     * Drives frameLength across the available bytes, emitting each complete
     * frame as a byte[] copy. Returns the number of bytes consumed from
     * [base, base + avail) — the caller advances the reader index by that much
     * and Netty retains the remainder for the next call.
     *
     * This is the Netty-free core: a test can simulate the cumulation buffer by
     * dropping `consumed` bytes off the front, appending the next chunk, and
     * calling again.
     */
    static int frameAndEmit(byte[] data, int base, int avail, List<Object> out) {
        final int end = base + avail;
        int pos = base;

        while (true) {
            int start = indexOfBeginString(data, pos, end);
            if (start < 0) {
                // No BeginString left. Discard scanned garbage, but keep a
                // trailing '8' in case "8=" is split across the chunk boundary.
                int keep = (data[end - 1] == B8) ? 1 : 0;
                return (end - keep) - base;
            }

            int len = frameLength(data, start, end - start);
            if (len == NEED_MORE) {
                // Drop leading garbage up to the start; wait for the rest.
                return start - base;
            }
            if (len == MALFORMED) {
                // Skip this false/broken BeginString and resync.
                pos = start + 2;
                continue;
            }

            out.add(Arrays.copyOfRange(data, start, start + len));
            pos = start + len;
        }
    }

    /**
     * Total frame length for a message that (supposedly) starts at offset:
     * 8=...<SOH> 9=<n><SOH> [n body bytes] 10=xxx<SOH>. BodyLength (tag 9)
     * counts from the first body byte up to and including the SOH before 10=,
     * so frame end = firstBodyByte + n + 7.
     *
     * Returns the length (> 0), NEED_MORE if the message hasn't fully arrived,
     * or MALFORMED if the structure/prefix is wrong within the bytes present.
     */
    static int frameLength(byte[] buf, int offset, int available) {
        final int end = offset + available;

        if (available < 2) {
            return NEED_MORE;
        }
        if (buf[offset] != B8 || buf[offset + 1] != EQ) {
            return MALFORMED;
        }

        // SOH terminating the BeginString (tag 8) field.
        int soh1 = indexOf(buf, offset + 2, end, SOH);
        if (soh1 < 0) {
            return NEED_MORE;
        }

        // BodyLength must follow immediately: "9=".
        if (soh1 + 3 > end) {
            return NEED_MORE;
        }
        if (buf[soh1 + 1] != B9 || buf[soh1 + 2] != EQ) {
            return MALFORMED;
        }

        // BodyLength value up to the next SOH.
        int soh2 = indexOf(buf, soh1 + 3, end, SOH);
        if (soh2 < 0) {
            return NEED_MORE;
        }
        if (soh2 == soh1 + 3) {
            return MALFORMED; // empty body length
        }
        long n = FixParser.parseLong(buf, soh1 + 3, soh2);
        if (n <= 0 || n > FixConstants.MAX_FRAME) {
            return MALFORMED;
        }

        // firstBodyByte = soh2 + 1. Compute in long to dodge int overflow.
        long endExclusive = (long) (soh2 + 1) + n + TRAILER_LEN;
        if (endExclusive > end) {
            return NEED_MORE;
        }

        // Trailer sanity: "10=" ... <SOH>. Real integrity is the parser's
        // checksum; this only rejects an obviously mis-sized length prefix.
        int t = (int) endExclusive - TRAILER_LEN;
        if (buf[t] != B1 || buf[t + 1] != B0 || buf[t + 2] != EQ
                || buf[(int) endExclusive - 1] != SOH) {
            return MALFORMED;
        }

        return (int) (endExclusive - offset);
    }

    /** First index i in [from, end) with buf[i]=='8' && buf[i+1]=='='; else -1. */
    static int indexOfBeginString(byte[] buf, int from, int end) {
        for (int i = from; i + 1 < end; i++) {
            if (buf[i] == B8 && buf[i + 1] == EQ) {
                return i;
            }
        }
        return -1;
    }

    private static int indexOf(byte[] buf, int from, int end, byte target) {
        for (int i = from; i < end; i++) {
            if (buf[i] == target) {
                return i;
            }
        }
        return -1;
    }
}