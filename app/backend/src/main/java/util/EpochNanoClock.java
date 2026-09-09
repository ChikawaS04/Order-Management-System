package util;

import java.util.function.LongSupplier;

/**
 * Wall-clock time as {@code long} epoch nanoseconds, from a source whose deltas are
 * exact.
 *
 * <p>{@link System#nanoTime()} is monotonic and high-resolution but has an arbitrary
 * origin, so it cannot be read as a date. {@link System#currentTimeMillis()} is epoch
 * but only millisecond-resolution and not monotonic. This clock combines the two: at
 * construction it captures both together, then serves
 * {@code anchorEpochNanos + (System.nanoTime() - anchorNanos)}. The result is true Unix
 * epoch nanoseconds carried at nanosecond resolution.
 *
 * <p>The transform is affine (a fixed offset added to {@code System.nanoTime()}), so the
 * difference between any two readings equals the difference of their underlying
 * {@code nanoTime} reads exactly. Latency measured as a delta of two stamps is therefore
 * unaffected by the epoch conversion, which is why the same instance can feed both the
 * gateway's receipt stamp and the handler's execution/snapshot stamps and still yield an
 * exact receipt-to-publish delta (SRS §6.3).
 *
 * <p><b>Anchor drift.</b> The epoch anchor is captured once, at construction. Thereafter
 * the clock advances purely by {@code nanoTime} elapsed and never re-reads the wall clock,
 * so it does not track adjustments (NTP step or slew, leap-second smearing) applied after
 * startup. Over a long-running session its absolute value can drift from true wall-clock
 * time by the accumulated correction. Relative ordering and inter-event deltas stay exact;
 * only the absolute epoch value drifts. For a demo terminal this is immaterial; a process
 * expected to stay accurate over days would re-anchor periodically instead.
 *
 * <p><b>Threading.</b> Immutable after construction and backed by {@code System.nanoTime()},
 * so {@link #getAsLong()} is safe to call from any thread. The instance is shared across the
 * gateway and engine-handler seams by design: one anchor, one domain.
 */
public final class EpochNanoClock implements LongSupplier {

    private static final long NANOS_PER_MILLI = 1_000_000L;

    private final long anchorEpochNanos;
    private final long anchorNanos;
    private final LongSupplier nanoSource;

    /**
     * Anchors on {@code System.currentTimeMillis()} and {@code System.nanoTime()}, captured
     * together at construction.
     */
    public EpochNanoClock() {
        this(System::currentTimeMillis, System::nanoTime);
    }

    /**
     * Test seam: inject the epoch-millis anchor source and the nanosecond source so a test
     * can drive both deterministically and assert the affine arithmetic. Package-private on
     * purpose; production code uses the no-arg constructor.
     */
    EpochNanoClock(LongSupplier epochMillisSource, LongSupplier nanoSource) {
        this.anchorEpochNanos = epochMillisSource.getAsLong() * NANOS_PER_MILLI;
        this.anchorNanos = nanoSource.getAsLong();
        this.nanoSource = nanoSource;
    }

    @Override
    public long getAsLong() {
        return anchorEpochNanos + (nanoSource.getAsLong() - anchorNanos);
    }
}