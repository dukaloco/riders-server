import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { env } from "../config/env";
import { User } from "../models/User";

export const authPlugin = new Elysia({ name: "auth" })
    .use(
        jwt({
            name: "accessJwt",
            secret: env.JWT_SECRET,
            exp: env.JWT_EXPIRES_IN,
        })
    )
    .derive({ as: "scoped" }, async ({ accessJwt, headers }) => {
        const authHeader = headers["authorization"];
        const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

        if (!token) return { user: null };

        const payload = await accessJwt.verify(token);
        if (!payload) return { user: null };

        return {
            user: {
                id: payload.id as string,
                roles: payload.roles as Array<"rider" | "customer" | "admin">,
                phone: payload.phone as string,
            },
        };
    })
    .macro(({ onBeforeHandle }) => ({
        isAuth: (roles?: Array<"rider" | "customer" | "admin">) => {
            onBeforeHandle(({ user, set }: { user: any; set: any }) => {
                if (!user) {
                    set.status = 401;
                    return { success: false, message: "Authentication required" };
                }
                if (roles && !user.roles.some((r: string) => roles.includes(r as any))) {
                    set.status = 403;
                    return { success: false, message: "Forbidden: insufficient permissions" };
                }
            });
        },
        isApprovedRider: () => {
            onBeforeHandle(async ({ user, set }: { user: any; set: any }) => {
                if (!user || !user.roles.includes("rider")) {
                    set.status = 403;
                    return { success: false, message: "Riders only" };
                }
                const dbUser = await User.findById(user.id);
                if (!dbUser?.riderProfile?.isApproved) {
                    set.status = 403;
                    return { success: false, message: "Rider account not yet approved" };
                }
            });
        },
    }));
