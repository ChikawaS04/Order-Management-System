package event;

/**
 * Discriminates the two inbound message types carried on the inbound ring buffer.
 * Set by FixParser from the FIX 35= field; read by the matching engine to decide
 * whether to place a new order or cancel a resting one.
 */
public enum OrderEventType {
    NEW_ORDER, CANCEL_ORDER
}
