package gateway;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

class FixParserScanTest {

    private FixParser parser;

    @BeforeEach
    void setUp() {
        parser = new FixParser();
    }

    // --- helpers ---------------------------------------------------------

    /** Joins fields with SOH, terminating each (including the last). */
    private static byte[] msg(String... fields) {
        StringBuilder sb = new StringBuilder();
        for (String f : fields) {
            sb.append(f).append((char) 0x01);
        }
        return sb.toString().getBytes(StandardCharsets.US_ASCII);
    }

    /** Extracts the value of the i-th scanned triple as a string. */
    private String value(byte[] buf, int i) {
        return new String(
                buf, parser.valStarts[i], parser.valEnds[i] - parser.valStarts[i],
                StandardCharsets.US_ASCII);
    }

    // --- valid messages --------------------------------------------------

    @Test
    @DisplayName("realistic message: session tags pass through in order, not rejected")
    void realisticMessageWithSessionTags() {
        byte[] buf = msg(
                "8=FIX.4.4", "9=90", "35=D",
                "49=SENDER", "56=TARGET", "34=2", "52=20260723-12:00:00",
                "11=12345", "54=1", "44=150.25", "38=100", "55=ASML",
                "10=123");

        int count = parser.scan(buf, 0, buf.length);

        assertEquals(13, count);
        assertArrayEquals(
                new int[]{8, 9, 35, 49, 56, 34, 52, 11, 54, 44, 38, 55, 10},
                Arrays.copyOf(parser.tags, count),
                "every tag, including session tags 49/56/34/52, yielded in order");
    }

    @Test
    @DisplayName("single field parses to one triple")
    void singleField() {
        byte[] buf = msg("35=D");

        int count = parser.scan(buf, 0, buf.length);

        assertEquals(1, count);
        assertEquals(35, parser.tags[0]);
        assertEquals("D", value(buf, 0));
    }

    @Test
    @DisplayName("value containing '=' is delimited only by SOH")
    void valueContainingEquals() {
        byte[] buf = msg("55=AS=ML");

        int count = parser.scan(buf, 0, buf.length);

        assertEquals(1, count);
        assertEquals(55, parser.tags[0]);
        assertEquals("AS=ML", value(buf, 0), "first '=' ends the tag, SOH ends the value");
    }

    @Test
    @DisplayName("empty value is structurally valid (field-type check is Step 5's job)")
    void emptyValueAccepted() {
        byte[] buf = msg("11=", "35=D");

        int count = parser.scan(buf, 0, buf.length);

        assertEquals(2, count);
        assertEquals(11, parser.tags[0]);
        assertEquals("", value(buf, 0), "valStart == valEnd, a legal empty range");
    }

    @Test
    @DisplayName("scan respects offset/length inside a larger buffer")
    void respectsOffsetAndLength() {
        byte[] inner = msg("35=D", "11=99", "55=ASML");
        byte[] buf = new byte[inner.length + 10];
        Arrays.fill(buf, (byte) 'X');
        System.arraycopy(inner, 0, buf, 5, inner.length);

        int count = parser.scan(buf, 5, inner.length);

        assertEquals(3, count);
        assertArrayEquals(new int[]{35, 11, 55}, Arrays.copyOf(parser.tags, count));
        assertEquals("ASML", value(buf, 2), "value offsets point into the correct region");
    }

    @Test
    @DisplayName("exactly MAX_FIELDS is accepted")
    void maxFieldsAccepted() {
        String[] fields = new String[FixConstants.MAX_FIELDS];
        Arrays.fill(fields, "35=D");
        byte[] buf = msg(fields);

        assertEquals(FixConstants.MAX_FIELDS, parser.scan(buf, 0, buf.length));
    }

    // --- rejects ---------------------------------------------------------

    @Test
    @DisplayName("field missing '=' rejects")
    void missingEquals() {
        byte[] buf = msg("8=FIX.4.4", "NoEquals", "35=D");

        assertEquals(-1, parser.scan(buf, 0, buf.length));
    }

    @Test
    @DisplayName("empty tag rejects (parseLong returns -1)")
    void emptyTag() {
        byte[] buf = msg("=BUY");

        assertEquals(-1, parser.scan(buf, 0, buf.length));
    }

    @Test
    @DisplayName("non-numeric tag rejects (parseLong returns -1)")
    void nonNumericTag() {
        byte[] buf = msg("3X=D");

        assertEquals(-1, parser.scan(buf, 0, buf.length));
    }

    @Test
    @DisplayName("value not terminated by SOH rejects")
    void unterminatedValue() {
        // second field has no trailing SOH — built without the helper
        byte[] buf = "8=FIX.4.4\u000135=D".getBytes(StandardCharsets.US_ASCII);

        assertEquals(-1, parser.scan(buf, 0, buf.length));
    }

    @Test
    @DisplayName("more than MAX_FIELDS rejects rather than overflowing")
    void tooManyFields() {
        String[] fields = new String[FixConstants.MAX_FIELDS + 1];
        Arrays.fill(fields, "35=D");
        byte[] buf = msg(fields);

        assertEquals(-1, parser.scan(buf, 0, buf.length));
    }
}