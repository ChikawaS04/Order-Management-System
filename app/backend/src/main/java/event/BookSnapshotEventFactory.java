package event;

import com.lmax.disruptor.EventFactory;

/**
 * Pre-allocates empty BookSnapshotEvent slots for the snapshot ring buffer.
 * The one file in the snapshot path that touches com.lmax — the carrier itself
 * stays framework-free.
 *
 * Each slot allocates its four fixed-size depth arrays once, here, at Disruptor
 * construction time. Nothing on the publish path allocates thereafter (SRS §5.1).
 */
public final class BookSnapshotEventFactory implements EventFactory<BookSnapshotEvent> {
    @Override
    public BookSnapshotEvent newInstance() {
        return new BookSnapshotEvent();
    }
}