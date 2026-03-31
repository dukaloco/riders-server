/**
 * Base application error.
 * Every subclass carries its own HTTP status code and a short machine-readable
 * code, so the global error handler never has to parse error messages.
 */
export class AppError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string
    ) {
        super(message);
        this.name = this.constructor.name;
        // Restore prototype chain (needed when targeting ES5)
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// 400
export class BadRequestError extends AppError {
    constructor(message = "Bad request") {
        super(message, 400, "BAD_REQUEST");
    }
}

// 401
export class UnauthorizedError extends AppError {
    constructor(message = "Authentication required") {
        super(message, 401, "UNAUTHORIZED");
    }
}

// 403
export class ForbiddenError extends AppError {
    constructor(message = "Access denied") {
        super(message, 403, "FORBIDDEN");
    }
}

// 404
export class NotFoundError extends AppError {
    constructor(message = "Resource not found") {
        super(message, 404, "NOT_FOUND");
    }
}

// 409
export class ConflictError extends AppError {
    constructor(message = "Resource already exists") {
        super(message, 409, "CONFLICT");
    }
}

// 410 — resource existed but is now gone (e.g. expired OTP)
export class GoneError extends AppError {
    constructor(message = "Resource no longer available") {
        super(message, 410, "GONE");
    }
}

// 429
export class TooManyRequestsError extends AppError {
    constructor(message = "Too many requests. Please slow down.") {
        super(message, 429, "TOO_MANY_REQUESTS");
    }
}

// 500
export class InternalError extends AppError {
    constructor(message = "An unexpected error occurred") {
        super(message, 500, "INTERNAL_ERROR");
    }
}
