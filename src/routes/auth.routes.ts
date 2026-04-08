import { Elysia, t } from "elysia";
import { AuthService } from "../services/auth.service";
import { OtpService } from "../services/otp.service";
import { authPlugin } from "../middleware/auth.middleware";
import { rateLimitPlugin } from "../middleware/rate-limit.middleware";
import { User } from "../models/User";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../utils/errors";

const phoneSchema = t.String({ minLength: 9, maxLength: 16, pattern: "^\\+[1-9]\\d{7,14}$" });
const otpSchema = t.String({ minLength: 6, maxLength: 6, pattern: "^[0-9]{6}$" });

export const authRoutes = new Elysia({ prefix: "/api/auth" })
    .use(authPlugin)
    // .use(rateLimitPlugin({ max: 20, windowSeconds: 900, keyPrefix: "auth", message: "Too many attempts. Please try again later." }))

    // ─── Registration ─────────────────────────────────────────────────────────

    .post(
        "/register",
        async ({ body }) => {
            if (body.role === "admin") {
                throw new ForbiddenError("Admin accounts cannot be created through this endpoint.");
            }

            const existing = await User.findOne({ phone: body.phone });
            if (existing) throw new ConflictError("Phone number already registered.");

            // name is collected during onboarding step 1
            await OtpService.storePendingRegistration({ ...body, name: "" });
            await OtpService.send(body.phone);

            return { success: true, message: "OTP sent. Please check your phone for the verification code." };
        },
        {
            body: t.Object({
                phone:    phoneSchema,
                password: t.String({ minLength: 6, maxLength: 100 }),
                role:     t.Enum({ rider: "rider", customer: "customer", admin: "admin" }),
            }),
        }
    )

    // ─── Send OTP (login = existing user; register = pending signup) ─
    // Phone login: no password — POST /send-otp { flow: "login" } then /verify-otp.
    // Email login: POST /login-email with password only.

    .post(
        "/send-otp",
        async ({ body }) => {
            if (body.flow === "login") {
                const user = await User.findOne({ phone: body.phone, isActive: true });
                if (!user) {
                    throw new UnauthorizedError(
                        "No account found for this number. Sign up to create one."
                    );
                }
                await OtpService.send(body.phone);
                return {
                    success: true,
                    message: "OTP sent. Please check your phone for the verification code.",
                };
            }

            const pending = await OtpService.getPendingRegistration(body.phone);
            if (!pending) {
                throw new BadRequestError(
                    "Registration session expired. Go back and sign up again."
                );
            }
            await OtpService.send(body.phone);
            return {
                success: true,
                message: "OTP sent. Please check your phone for the verification code.",
            };
        },
        {
            body: t.Object({
                phone:  phoneSchema,
                flow:   t.Union([t.Literal("login"), t.Literal("register")]),
            }),
        }
    )

    // ─── Login with email + password (no OTP) ─────────────────────────────────

    .post(
        "/login-email",
        async ({ body }) => {
            const email = body.email.trim().toLowerCase();
            const user = await User.findOne({ email, isActive: true });
            if (!user) throw new UnauthorizedError("No account found for this email. Sign up to create one.");

            const isMatch = await user.comparePassword(body.password);
            if (!isMatch) throw new UnauthorizedError("Invalid credentials.");

            const token = AuthService.issueToken(user);
            return {
                success: true,
                message: "Login successful",
                data: { user: user.toPublicJSON(), accessToken: token },
            };
        },
        {
            body: t.Object({
                email:    t.String({ format: "email" }),
                password: t.String({ minLength: 1, maxLength: 100 }),
            }),
        }
    )

    // ─── Admin login (email or username + password) ───────────────────────────

    .post(
        "/admin/login",
        async ({ body }) => {
            console.log('body',body);
            const identifier = body.identifier.trim().toLowerCase();
            if (!identifier) throw new UnauthorizedError("Invalid credentials.");

            const user = await User.findOne({
                role: "admin",
                isActive: true,
                $or: [{ email: identifier }, { username: identifier }],
            });

            if (!user?.password) {
                throw new UnauthorizedError("Invalid credentials.");
            }

            const isMatch = await user.comparePassword(body.password);
            if (!isMatch) throw new UnauthorizedError("Invalid credentials.");

            const token = AuthService.issueToken(user);
            return {
                success: true,
                message: "Login successful",
                data: { user: user.toPublicJSON(), accessToken: token },
            };
        },
        {
            body: t.Object({
                identifier: t.String({ minLength: 1, maxLength: 200 }),
                password:   t.String({ minLength: 1, maxLength: 100 }),
            }),
        }
    )

    // ─── Shared OTP verification (login + registration) ───────────────────────

    .post(
        "/verify-otp",
        async ({ body, set }) => {
            await OtpService.verify(body.phone, body.otp);

            const pending = await OtpService.getPendingRegistration(body.phone);

            if (pending) {
                const user = new User({
                    firstName: '',
                    lastName:  '',
                    phone: pending.phone,
                    password: pending.password,
                    email: pending.email,
                    role: pending.role,
                    isPhoneVerified: true,
                });

                await user.save();
                await OtpService.clearPendingRegistration(body.phone);

                const token = AuthService.issueToken(user);
                set.status = 201;
                return {
                    success: true,
                    message: "Registration successful",
                    data: { user: user.toPublicJSON(), accessToken: token },
                };
            }

            const user = await User.findOne({ phone: body.phone, isActive: true });
            if (!user) throw new NotFoundError("User not found.");

            const token = AuthService.issueToken(user);
            return {
                success: true,
                message: "Login successful",
                data: { user: user.toPublicJSON(), accessToken: token },
            };
        },
        {
            body: t.Object({
                phone: phoneSchema,
                otp: otpSchema,
            }),
        }
    )

    // ─── Protected routes ─────────────────────────────────────────────────────

    .post(
        "/logout",
        async ({ user }) => {
            await AuthService.logout(user!.id);
            return { success: true, message: "Logged out successfully." };
        },
        { isAuth: true }
    )

    // ─── Get user profile ──────────────────────────────────────────────────────

    .get(
        "/me",
        async ({ user, set }) => {
            const dbUser = await User.findById(user!.id).select("-password");
            if (!dbUser) throw new NotFoundError("User not found.");
            return { success: true, message: "Profile fetched", data: dbUser };
        },
        { isAuth: true }
    );
