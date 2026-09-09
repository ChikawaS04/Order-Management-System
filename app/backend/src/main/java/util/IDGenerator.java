package util;

import java.util.concurrent.atomic.AtomicLong;

public class IDGenerator {
    private static final AtomicLong orderIDCounter = new AtomicLong(0);
    private static final AtomicLong participantIDCounter = new AtomicLong(0);
    private static final AtomicLong tradeIDCounter = new AtomicLong(0);

    public static long nextOrderID() {
        return orderIDCounter.incrementAndGet ();
    }

    public static long nextParticipantID() {
        return participantIDCounter.incrementAndGet ();
    }

    public static long nextTradeID() { return tradeIDCounter.incrementAndGet (); }
}
