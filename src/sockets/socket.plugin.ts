import { Elysia, t } from "elysia";
import { redis, REDIS_KEYS, TTL } from "../config/redis";
import { User } from "../models/User";
import { jwt } from "@elysiajs/jwt";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export const socketPlugin = new Elysia({ name: "sockets" })
    .use(
        jwt({
            name: "accessJwt",
            secret: env.JWT_SECRET,
        })
    )
    .derive(async ({ accessJwt, query }) => {
        const token = query.token;
        if (!token) return { user: null };

        const payload = await accessJwt.verify(token);
        if (!payload) return { user: null };

        return {
            user: {
                id: payload.id as string,
                role: payload.role as string,
            },
        };
    })
    .ws("/ws", {
        body: t.Object({
            type: t.String(),
            payload: t.Any(),
        }),
        async open(ws) {
            if (!ws.data.user) return ws.close();

            logger.info(` WS Connected: ${ws.data.user.id} (${ws.data.user.role})`);

            // Store socket availability in Redis
            await redis.setex(REDIS_KEYS.riderSocket(ws.data.user.id), 3600, "active");

            // Join personal room
            ws.subscribe(`user:${ws.data.user.id}`);

            if (ws.data.user.role === "rider") {
                ws.subscribe("rider:pool");
            }
        },
        async message(ws, { type, payload }) {
            const user = ws.data.user;
            if (!user) return;

            switch (type) {
                case "location:update":
                    if (user.role !== "rider") return;
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
                    ws.publish(`tracker:${user.id}`, {
                        type: "rider:location",
                        payload: {
                            riderId: user.id,
                            latitude,
                            longitude,
                            heading,
                            speed,
                            timestamp: Date.now(),
                        },
                    });
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
                    ws.send({ type: "heartbeat:ack", payload: { ts: Date.now() } });
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
