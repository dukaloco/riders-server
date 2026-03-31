import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { User } from "../models/User";
import type { IUser } from "../models/User";

export interface TokenPayload {
    id: string;
    role: "rider" | "customer" | "admin";
    phone: string;
}

export const generateAccessToken = (payload: TokenPayload): string =>
    jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as any,
    });

export const verifyAccessToken = (token: string): TokenPayload =>
    jwt.verify(token, env.JWT_SECRET) as TokenPayload;

export const AuthService = {

    issueToken: (user: IUser): string => {
        const payload: TokenPayload = {
            id: user._id.toString(),
            role: user.role,
            phone: user.phone,
        };
        return generateAccessToken(payload);
    },

    logout: async (_userId: string): Promise<void> => {
        // Stateless JWT — client is responsible for discarding the token.
        // Add a Redis blocklist here in the future if server-side revocation is needed.
    },
};
