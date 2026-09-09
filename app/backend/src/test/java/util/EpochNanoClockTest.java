package util;

import org.junit.jupiter.api.Test;

import java.util.function.LongSupplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EpochNanoClockTest {

    /** A LongSupplier that returns the given values in order, one per call. */
    private static LongSupplier sequence(long... values) {
        int[] idx = {0};
        return () -> values[idx[0]++];
    }

    @Test
    void affineDeltaPreservesInjectedNanoDelta() {
        // Construction consumes the first nano reading as the anchor (1_000);
        // each getAsLong consumes the next.
        LongSupplier nanos = sequence(1_000L, 1_000L, 5_000L, 8_000L);
        EpochNanoClock clock = new EpochNanoClock(() -> 1_000L, nanos);

        long t1 = clock.getAsLong();   // nano read 1_000 -> anchorEpoch + 0
        long t2 = clock.getAsLong();   // nano read 5_000 -> anchorEpoch + 4_000
        long t3 = clock.getAsLong();   // nano read 8_000 -> anchorEpoch + 7_000

        // Output deltas equal the injected nano-reading deltas exactly.
        assertEquals(5_000L - 1_000L, t2 - t1);
        assertEquals(8_000L - 5_000L, t3 - t2);
    }

    @Test
    void anchorConvertsMillisToNanosAtZeroDelta() {
        // epochMillis 1_000 -> 1_000 * 1_000_000 nanos; nano delta held at zero.
        EpochNanoClock clock = new EpochNanoClock(() -> 1_000L, sequence(0L, 0L));

        assertEquals(1_000_000_000L, clock.getAsLong());
    }

    @Test
    void nonDecreasingNanoSourceYieldsNonDecreasingOutput() {
        // Includes equal-consecutive readings (100,100 and 200,200).
        LongSupplier nanos = sequence(100L, 100L, 100L, 200L, 200L, 5_000L);
        EpochNanoClock clock = new EpochNanoClock(() -> 0L, nanos);

        long prev = Long.MIN_VALUE;
        for (int i = 0; i < 5; i++) {
            long t = clock.getAsLong();
            assertTrue(t >= prev, "output must be non-decreasing");
            prev = t;
        }
    }

    @Test
    void realClockIsMonotonicAcrossCalls() {
        EpochNanoClock clock = new EpochNanoClock();

        long a = clock.getAsLong();
        long b = clock.getAsLong();

        assertTrue(b >= a, "System.nanoTime() is monotonic, so the clock must be too");
    }

    @Test
    void realClockValueFallsInSaneEpochWindow() {
        EpochNanoClock clock = new EpochNanoClock();

        long now = clock.getAsLong();

        // ~2023-11 in epoch nanos .. ~2096 in epoch nanos: comfortably brackets any real run.
        assertTrue(now > 1_700_000_000_000_000_000L, "should be after ~Nov 2023");
        assertTrue(now < 4_000_000_000_000_000_000L, "should be before ~2096");
    }
}