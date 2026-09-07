package event;

import com.lmax.disruptor.EventFactory;

/** Pre-allocates empty ExecutionEvent slots for the outbound ring buffer. */
public final class ExecutionEventFactory implements EventFactory<ExecutionEvent> {
    @Override
    public ExecutionEvent newInstance() {
        return new ExecutionEvent();
    }
}