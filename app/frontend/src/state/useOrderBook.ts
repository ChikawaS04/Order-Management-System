/**
 * Socket lifecycle. The only impure module in the data layer: it owns the
 * WebSocket, reconnects with capped backoff, narrows every inbound frame through
 * parseServerFrame, and dispatches into the pure reducer.
 *
 * StrictMode-safe: the effect's cleanup detaches handlers, clears the pending
 * retry timer, and closes the socket, so a double-invoked mount cannot leave an
 * orphan connection or a zombie reconnect loop.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";

import { parseServerFrame } from "../protocol/messages";
import type { ClientFrame } from "../protocol/messages";
import { serializeClientFrame } from "../protocol/encode";
import { initialState, reducer } from "./reducer";
import type { AppState } from "./reducer";

const DEFAULT_WS_URL = "ws://localhost:8080/ws";
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4000;

export interface OrderBookApi {
    readonly state: AppState;
    /** Serializes and sends; returns false if the socket isn't open. */
    readonly send: (frame: ClientFrame) => boolean;
}

export function useOrderBook(url: string = import.meta.env.VITE_WS_URL ?? DEFAULT_WS_URL): OrderBookApi {
    const [state, dispatch] = useReducer(reducer, initialState);
    const socketRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        let disposed = false;
        let socket: WebSocket | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;

        const detach = (ws: WebSocket): void => {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
        };

        const connect = (): void => {
            if (disposed) return;

            dispatch({ type: "CONNECTION", status: attempt === 0 ? "connecting" : "reconnecting" });

            const ws = new WebSocket(url);
            socket = ws;
            socketRef.current = ws;

            ws.onopen = () => {
                if (disposed) return;
                attempt = 0;
                dispatch({ type: "CONNECTION", status: "open" });
            };

            ws.onmessage = (event: MessageEvent) => {
                if (disposed) return;
                if (typeof event.data !== "string") return; // server only ever sends text frames
                const frame = parseServerFrame(event.data);
                if (frame === null) {
                    console.warn("dropping unparseable server frame");
                    return;
                }
                dispatch({ type: "FRAME", frame });
            };

            // No handling needed: an error is always followed by close, which retries.
            ws.onerror = () => {};

            ws.onclose = () => {
                if (disposed) return;
                detach(ws);
                if (socketRef.current === ws) socketRef.current = null;
                socket = null;

                // Clears the book (a stale ladder is worse than an empty one). Note the
                // server only pushes BOOK per inbound event, so a reconnected client
                // sees an empty ladder until the next order flows anywhere on the book.
                dispatch({ type: "CONNECTION", status: "reconnecting" });

                const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
                attempt += 1;
                timer = setTimeout(connect, delay);
            };
        };

        connect();

        return () => {
            disposed = true;
            if (timer !== null) clearTimeout(timer);
            socketRef.current = null;
            if (socket !== null) {
                detach(socket);
                socket.close();
            }
        };
    }, [url]);

    const send = useCallback((frame: ClientFrame): boolean => {
        const ws = socketRef.current;
        if (ws === null || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(serializeClientFrame(frame));
        dispatch({ type: "SENT", frame });
        return true;
    }, []);

    return { state, send };
}