package gateway;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class FixParserChecksumTest {

    private static final byte SOH = 0x01;

    /** '|' stands in for the SOH field terminator, so the messages stay readable. */
    private static byte[] msg(String pipeDelimited) {
        byte[] b = pipeDelimited.getBytes(StandardCharsets.US_ASCII);
        for (int i = 0; i < b.length; i++) {
            if (b[i] == '|') {
                b[i] = SOH;
            }
        }
        return b;
    }

    // Known-good NewOrderSingle. 10=026 was computed independently: the sum of every
    // byte up to and including the SOH before "10=", mod 256. (validateChecksum does
    // not inspect tag 9, so its value is irrelevant to this step.)
    private static final String GOOD =
            "8=FIX.4.2|9=64|35=D|49=CLIENT|56=OMS|34=2|11=12345|54=1|44=150.25|38=100|55=ASML|10=026|";

    // ---- the three the guide asks for ----

    @Test
    void validChecksum_passes() {
        byte[] m = msg(GOOD);
        assertTrue(FixParser.validateChecksum(m, 0, m.length));
    }

    @Test
    void corruptedBodyByte_fails() {
        // 44=150.25 -> 44=150.35: one body digit flipped, checksum left stale.
        byte[] m = msg(
                "8=FIX.4.2|9=64|35=D|49=CLIENT|56=OMS|34=2|11=12345|54=1|44=150.35|38=100|55=ASML|10=026|");
        assertFalse(FixParser.validateChecksum(m, 0, m.length));
    }

    @Test
    void wrongChecksumValue_fails() {
        // Body is correct (sums to 026) but the trailer claims 099.
        byte[] m = msg(
                "8=FIX.4.2|9=64|35=D|49=CLIENT|56=OMS|34=2|11=12345|54=1|44=150.25|38=100|55=ASML|10=099|");
        assertFalse(FixParser.validateChecksum(m, 0, m.length));
    }

    // ---- three that cover the code paths the guide's three don't ----

    @Test
    void nonDigitChecksumField_fails() {
        // parseLong returns -1L on the 'A'; -1 can't equal a 0..255 sum, so it rejects.
        byte[] m = msg(
                "8=FIX.4.2|9=64|35=D|49=CLIENT|56=OMS|34=2|11=12345|54=1|44=150.25|38=100|55=ASML|10=02A|");
        assertFalse(FixParser.validateChecksum(m, 0, m.length));
    }

    @Test
    void tooShortToHoldTrailer_fails() {
        byte[] m = msg("10=026|"); // 7 bytes: no room for a summed byte + trailer
        assertFalse(FixParser.validateChecksum(m, 0, m.length));
    }

    @Test
    void honorsOffsetAndLength() {
        // Same good message embedded in a wider buffer with junk on both sides.
        // Proves the sum region and trailer are located from offset/length, not 0/array-end.
        byte[] good = msg(GOOD);
        byte[] wide = new byte[good.length + 8];
        Arrays.fill(wide, (byte) '#');
        int offset = 4;
        System.arraycopy(good, 0, wide, offset, good.length);
        assertTrue(FixParser.validateChecksum(wide, offset, good.length));
    }
}