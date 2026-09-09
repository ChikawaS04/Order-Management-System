/**
 * Header (SRS §3.7, rebuilt in P7-3). Two rows, the way a real terminal carries
 * them. No product name, no tagline: the phase strips marketing chrome and shows
 * only what the server sent or a documented client-side derivation.
 *
 * Instrument row, all derived from BOOK plus the session aggregates (never from
 * EXEC arrival order): symbol, last, session change, bid, ask, mid, spread in
 * cents and basis points, session volume.
 *
 * Session row: connection state (the reused P5-5 ConnectionBadge), the
 * client-assigned FIX session identity (SenderCompID / TargetCompID / MsgSeqNum),
 * and the time the last frame was received. The three identity fields are
 * client-assigned and labelled as such: the produced FIX subset carries no tag
 * 34/49/56 (P7-0/Q7-4), so none is a value the server sent.
 *
 * The derivation is a pure exported helper (mirrors P5-2 buildLadder / P5-4
 * validateOrderInput) so it is unit-tested without a DOM. Spread cents/bps and
 * change stay local pure helpers here; the midpoint formatter moved to format.ts
 * in P7-4 so this header and the depth-ladder divider share one definition
 * instead of each keeping its own.
 */

import { centsToDollars, EMPTY_PRICE, midpointLabel } from "../format";
import { ConnectionBadge } from "./ConnectionBadge";
import type { BookState, ConnectionStatus, TapeEntry } from "../state/reducer";

const SYMBOL = "ASML";

/**
 * Client-assigned FIX session identity. Display constants, not wire data: the
 * produced-and-parsed FIX subset emits no SenderCompID (49) or TargetCompID (56)
 * at all (P7-0/Q7-4), so presenting them as server values would be a lie. They
 * are labelled client-assigned in the row.
 */
const SENDER_COMP_ID = "OMS-UI";
const TARGET_COMP_ID = "OMS-ENGINE";

export type ChangeDirection = "up" | "down" | "flat" | "none";

export interface HeaderModel {
    readonly last: string;
    readonly changeAbs: string;
    readonly changePct: string;
    readonly changeDir: ChangeDirection;
    readonly bestBid: string;
    readonly bestAsk: string;
    readonly mid: string;
    readonly spreadCents: string;
    readonly spreadBps: string;
    readonly volume: string;
    readonly lastFrame: string;
}

export interface HeaderInput {
    readonly book: BookState;
    readonly tape: readonly TapeEntry[];
    readonly sessionVolume: number;
    readonly sessionOpenCents: number;
    readonly lastFrameNanos: number;
}

/** Both tops present and real (guards the -1 empty-book sentinel). */
function twoSided(bestBid: number, bestAsk: number): boolean {
    return bestBid > 0 && bestAsk > 0;
}

/** Spread as an integer number of cents ("50"), or EMPTY_PRICE when one-sided. */
function spreadCentsLabel(bestBid: number, bestAsk: number): string {
    if (!twoSided(bestBid, bestAsk)) return EMPTY_PRICE;
    return String(bestAsk - bestBid);
}

/**
 * Spread in basis points relative to the mid, from integer cents, at fixed
 * precision. bps = spread / mid * 10000 = 20000 * (ask - bid) / (ask + bid).
 * Only bps (an inherently fractional ratio) touches float, at the display edge;
 * prices stay integer cents. EMPTY_PRICE when one-sided.
 */
function spreadBpsLabel(bestBid: number, bestAsk: number): string {
    if (!twoSided(bestBid, bestAsk)) return EMPTY_PRICE;
    const bps = (20000 * (bestAsk - bestBid)) / (bestAsk + bestBid);
    return bps.toFixed(2);
}

interface ChangeParts {
    readonly abs: string;
    readonly pct: string;
    readonly dir: ChangeDirection;
}

/**
 * Session change against the session's first trade price. Signed dollar delta
 * (from integer cents) plus a signed percent (fractional, display edge only).
 * Blank until both a last price and a session-open price exist. There is no
 * previous close, so this is a session change, never a daily change. dir drives
 * the up/down colour.
 */
function changeLabel(lastCents: number, sessionOpenCents: number): ChangeParts {
    if (lastCents <= 0 || sessionOpenCents <= 0) {
        return { abs: EMPTY_PRICE, pct: EMPTY_PRICE, dir: "none" };
    }
    const deltaCents = lastCents - sessionOpenCents;
    const dir: ChangeDirection = deltaCents > 0 ? "up" : deltaCents < 0 ? "down" : "flat";
    const sign = deltaCents > 0 ? "+" : deltaCents < 0 ? "-" : "";
    const abs = `${sign}${centsToDollars(Math.abs(deltaCents))}`;
    const pctValue = (deltaCents / sessionOpenCents) * 100;
    const pct = `${deltaCents > 0 ? "+" : ""}${pctValue.toFixed(2)}%`;
    return { abs, pct, dir };
}

/**
 * Epoch-nanos to wall-clock HH:MM:SS.mmm in local time. Possible only because
 * P7-1 moved every timestamp into the epoch-nanos domain; the old monotonic
 * origin could not render wall-clock, and that frontend/README limitation is now
 * retired. EMPTY_PRICE when no frame has arrived (0).
 */
function formatClockNanos(nanos: number): string {
    if (nanos <= 0) return EMPTY_PRICE;
    const ms = Math.floor(nanos / 1_000_000);
    const d = new Date(ms);
    const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Pure, exported: every header field from one state slice. */
export function deriveHeader(input: HeaderInput): HeaderModel {
    const { book, tape, sessionVolume, sessionOpenCents, lastFrameNanos } = input;
    const lastCents = tape.length > 0 ? tape[0].priceCents : -1;
    const change = changeLabel(lastCents, sessionOpenCents);

    return {
        last: centsToDollars(lastCents),
        changeAbs: change.abs,
        changePct: change.pct,
        changeDir: change.dir,
        bestBid: centsToDollars(book.bestBid),
        bestAsk: centsToDollars(book.bestAsk),
        mid: midpointLabel(book.bestBid, book.bestAsk),
        spreadCents: spreadCentsLabel(book.bestBid, book.bestAsk),
        spreadBps: spreadBpsLabel(book.bestBid, book.bestAsk),
        volume: String(sessionVolume),
        lastFrame: formatClockNanos(lastFrameNanos),
    };
}

/** Append a unit only to a real value, leaving the EMPTY_PRICE sentinel bare. */
function withUnit(value: string, unit: string): string {
    return value === EMPTY_PRICE ? value : `${value}${unit}`;
}

export interface HeaderProps {
    readonly book: BookState;
    readonly tape: readonly TapeEntry[];
    readonly sessionVolume: number;
    readonly sessionOpenCents: number;
    readonly msgSeqNum: number;
    readonly lastFrameNanos: number;
    readonly connection: ConnectionStatus;
}

export function Header({
                           book,
                           tape,
                           sessionVolume,
                           sessionOpenCents,
                           msgSeqNum,
                           lastFrameNanos,
                           connection,
                       }: HeaderProps) {
    const m = deriveHeader({ book, tape, sessionVolume, sessionOpenCents, lastFrameNanos });

    const changeClass =
        m.changeDir === "up"
            ? " header__value--up"
            : m.changeDir === "down"
                ? " header__value--down"
                : "";

    return (
        <div className="header">
            <div className="header__instrument">
                <span className="header__ticker">{SYMBOL}</span>

                <div className="header__metric">
                    <span className="header__label">Last</span>
                    <span className="header__value" data-testid="header-last">{m.last}</span>
                </div>

                <div className="header__metric">
                    <span className="header__label">Chg</span>
                    <span className={`header__value${changeClass}`} data-testid="header-change">
            {m.changeAbs}
                        <span className="header__value-sub" data-testid="header-change-pct">{m.changePct}</span>
          </span>
                </div>

                <div className="header__metric header__metric--bid">
                    <span className="header__label">Bid</span>
                    <span className="header__value" data-testid="header-bid">{m.bestBid}</span>
                </div>

                <div className="header__metric header__metric--ask">
                    <span className="header__label">Ask</span>
                    <span className="header__value" data-testid="header-ask">{m.bestAsk}</span>
                </div>

                <div className="header__metric">
                    <span className="header__label">Mid</span>
                    <span className="header__value" data-testid="header-mid">{m.mid}</span>
                </div>

                <div className="header__metric">
                    <span className="header__label">Spread</span>
                    <span className="header__value" data-testid="header-spread">
            <span data-testid="header-spread-cents">{withUnit(m.spreadCents, "\u00A2")}</span>
            <span className="header__value-sub" data-testid="header-spread-bps">
              {withUnit(m.spreadBps, " bps")}
            </span>
          </span>
                </div>

                <div className="header__metric">
                    <span className="header__label">Volume</span>
                    <span className="header__value" data-testid="header-volume">{m.volume}</span>
                </div>
            </div>

            <div className="header__session">
                <ConnectionBadge status={connection} />

                <div className="header__session-id" data-testid="header-session-id">
                    <span className="header__session-tag">client-assigned</span>
                    <span className="header__session-field">
            <span className="header__label">SenderCompID</span>
            <span className="header__session-value" data-testid="header-sender">{SENDER_COMP_ID}</span>
          </span>
                    <span className="header__session-field">
            <span className="header__label">TargetCompID</span>
            <span className="header__session-value" data-testid="header-target">{TARGET_COMP_ID}</span>
          </span>
                    <span className="header__session-field">
            <span className="header__label">MsgSeqNum</span>
            <span className="header__session-value" data-testid="header-seqnum">{msgSeqNum}</span>
          </span>
                </div>

                <div className="header__metric header__metric--last-frame">
                    <span className="header__label">Last frame</span>
                    <span className="header__value" data-testid="header-last-frame">{m.lastFrame}</span>
                </div>
            </div>
        </div>
    );
}