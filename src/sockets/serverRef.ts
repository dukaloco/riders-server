/**
 * Holds a reference to the running Bun HTTP/WS server so any module (e.g. HTTP
 * route handlers) can broadcast WebSocket messages without importing the full
 * Elysia app instance — which would create circular dependencies.
 */

import { logger } from "../utils/logger";

type BunServer = {
    publish(
        topic: string,
        data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
        compress?: boolean,
    ): number;
};

let _server: BunServer | null = null;

export function setServer(server: BunServer): void {
    _server = server;
    logger.info("[serverRef] Bun server registered — WS broadcasting is ready");
}

/**
 * Broadcast a JSON message to all WebSocket clients subscribed to `channel`.
 * Returns the number of subscribers that received the message (0 = no one connected).
 */
export function wsBroadcast(channel: string, data: unknown): number {
    if (!_server) {
        logger.warn(`[serverRef] wsBroadcast called but server not registered (channel=${channel})`);
        return 0;
    }
    const count = _server.publish(channel, JSON.stringify(data));
    logger.debug(`[serverRef] published to "${channel}" → ${count} subscriber(s)`);
    return count;
}
