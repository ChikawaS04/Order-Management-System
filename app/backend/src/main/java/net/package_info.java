/**
 * Networking edge (Phase 4): Netty WebSocket server, JSON&lt;-&gt;FIX bridging, and the
 * WebSocket publisher. This is a system boundary — JSON (Jackson) serialization and
 * FIX encoding live here, never on the matching engine's hot path (SRS §5.5).
 */
package net;