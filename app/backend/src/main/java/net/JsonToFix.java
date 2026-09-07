package net;

import gateway.FixConstants;
import model.Side;

import java.nio.charset.StandardCharsets;

/**
 * Encodes a validated manual order into a complete FIX 4.2 tag-value message that the existing
 * FixParser accepts. Promotes the Phase-3 test {@code msg(...)} builder to production so the
 * WebSocket inbound path reuses the real FIX gateway rather than a parallel path (decision 1).
 *
 * <p>Framework-free: no io.netty, no com.lmax, no Jackson. Prices arrive as long cents (§4) and
 * are formatted to FIX decimal dollars (tag 44) here — the single cents&lt;-&gt;FIX bridge. The
 * {@code 9=} BodyLength and {@code 10=} CheckSum are computed exactly as the parser's checksum
 * validation expects; a round-trip test asserts {@code parse()} accepts the output.
 */
public final class JsonToFix {

    private static final byte SOH = FixConstants.SOH;   // 0x01 — the delimiter the parser splits on
    private static final char SOH_C = (char) SOH;
    private static final String BEGIN_STRING = "FIX.4.2";

    private JsonToFix() { }

    /** NewOrderSingle (35=D): tags 11, 55, 54, 38, 44 — the set parseNewOrder requires. */
    public static byte[] newOrderSingle(long clOrdId, Side side, long priceCents, long qty, String symbol) {
        return assemble(
                "35=D",
                "11=" + clOrdId,
                "55=" + symbol,
                "54=" + sideCode(side),
                "38=" + qty,
                "44=" + formatPrice(priceCents));
    }

    /** OrderCancelRequest (35=F): tags 11, 41 — the set parseCancel requires. */
    public static byte[] orderCancelRequest(long clOrdId, long origClOrdId) {
        return assemble(
                "35=F",
                "11=" + clOrdId,
                "41=" + origClOrdId);
    }

    /** FIX side code: 1 = buy, 2 = sell (mirrors FixParser.mapSide). */
    private static char sideCode(Side side) {
        return side == Side.BUY ? '1' : '2';
    }

    /** long cents -> FIX decimal dollars, always two places: 15025 -> "150.25", 5 -> "0.05". */
    static String formatPrice(long cents) {
        long dollars = cents / 100;
        long rem = cents % 100;
        return dollars + "." + (rem < 10 ? "0" + rem : Long.toString(rem));
    }

    /** Prepend 8=/9=&lt;bodylen&gt;, append 10=&lt;checksum&gt; — identical framing to the Phase-3 msg() builder. */
    private static byte[] assemble(String... bodyFields) {
        StringBuilder sb = new StringBuilder();
        for (String f : bodyFields) {
            sb.append(f).append(SOH_C);
        }
        byte[] body = sb.toString().getBytes(StandardCharsets.US_ASCII);

        byte[] header = ("8=" + BEGIN_STRING + SOH_C + "9=" + body.length + SOH_C)
                .getBytes(StandardCharsets.US_ASCII);

        int sum = 0;
        for (byte x : header) sum += (x & 0xFF);
        for (byte x : body) sum += (x & 0xFF);
        byte[] trailer = ("10=" + String.format("%03d", sum & 0xFF) + SOH_C)
                .getBytes(StandardCharsets.US_ASCII);

        byte[] out = new byte[header.length + body.length + trailer.length];
        System.arraycopy(header, 0, out, 0, header.length);
        System.arraycopy(body, 0, out, header.length, body.length);
        System.arraycopy(trailer, 0, out, header.length + body.length, trailer.length);
        return out;
    }
}