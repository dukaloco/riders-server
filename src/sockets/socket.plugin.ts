import { Elysia, t } from "elysia";
import { redis, REDIS_KEYS, TTL } from "../config/redis";
import { User } from "../models/User";
import { logger } from "../utils/logger";
import { verifyAccessToken } from "../services/auth.service";

export const socketPlugin = new Elysia({ name: "sockets" })
    .derive(async ({ query }) => {
        const token = query.token;
        if (!token) return { user: null };

        try {
            const payload = verifyAccessToken(token);
            // Always fetch roles from DB — the stored token may pre-date the
            // `roles` claim being added to the JWT, so we can't rely on the
            // JWT payload alone.
            const dbUser = await User.findById(payload.id).select("roles").lean();
            if (!dbUser) return { user: null };

            return {
                user: {
                    id:    payload.id,
                    roles: dbUser.roles as string[],
                },
            };
        } catch {
            return { user: null };
        }
    })
    .ws("/ws", {
        body: t.Object({
            type: t.String(),
            payload: t.Any(),
        }),
        async open(ws) {
            if (!ws.data.user) return ws.close();

            const { id, roles } = ws.data.user;
            // Normalise roles — @elysiajs/jwt (jose) may return them in a
            // different shape than expected when the token was signed with
            // the jsonwebtoken library.
            const roleList: string[] = Array.isArray(roles)
                ? roles
                : String(roles).split(",").map((r) => r.trim());

            try {
                // Subscribe FIRST — before any code that could throw, so the
                // rider is always reachable via server.publish even if later
                // steps fail.
                ws.subscribe(`user:${id}`);

                await redis.setex(REDIS_KEYS.riderSocket(id), 3600, "active");

                logger.info(` WS Connected: ${id} (${roleList.join(",")})`);

                if (roleList.includes("rider")) {
                    ws.subscribe("rider:pool");

                    // Flush any queued notifications that were sent while the
                    // rider was offline (e.g. trip:request during reconnection).
                    const notifKey = REDIS_KEYS.riderPendingNotif(id);
                    const pending  = await redis.get(notifKey);
                    if (pending) {
                        await redis.del(notifKey);
                        logger.info(` WS Flushing queued notification to rider ${id}`);
                        ws.send(pending);
                    }
                }
            } catch (err) {
                logger.error(`[socket] open handler error for ${id}: ${err}`);
            }
        },
        async message(ws, { type, payload }) {
            const user = ws.data.user;
            if (!user) return;

            switch (type) {
                case "location:update":
                    if (!user.roles.includes("rider")) return;
                    const { latitude, longitude, heading, speed } = payload;

                    // Persist to Redis
                    await redis.setex(
                        REDIS_KEYS.riderLocation(user.id),
                        TTL.RIDER_LOCATION,
                        JSON.stringify({ latitude, longitude, updatedAt: Date.now() })
                    );

                    // Update DB (debounced/background)
                    User.findByIdAndUpdate(user.id, {
                        "riderProfile.lastLocation": {
                            type: "Point",
                            coordinates: [longitude, latitude],
                            updatedAt: new Date(),
                        },
                    }).exec();

                    // Broadcast to anyone tracking this rider
                    ws.publish(
                        `tracker:${user.id}`,
                        JSON.stringify({
                            type: "rider:location",
                            payload: {
                                riderId: user.id,
                                latitude,
                                longitude,
                                heading,
                                speed,
                                timestamp: Date.now(),
                            },
                        }),
                    );
                    break;

                case "tracker:join":
                    ws.subscribe(`tracker:${payload.riderId}`);
                    logger.info(`${user.id} tracking rider ${payload.riderId}`);
                    break;

                case "tracker:leave":
                    ws.unsubscribe(`tracker:${payload.riderId}`);
                    break;

                case "heartbeat":
                    await redis.expire(REDIS_KEYS.riderSocket(user.id), 3600);
                    ws.send(JSON.stringify({ type: "heartbeat:ack", payload: { ts: Date.now() } }));
                    break;
            }
        },
        async close(ws) {
            if (ws.data.user) {
                await redis.del(REDIS_KEYS.riderSocket(ws.data.user.id));
                logger.info(`WS Disconnected: ${ws.data.user.id}`);
            }
        },
    });
