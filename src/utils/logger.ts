export type LogLevel = "info" | "warn" | "error" | "debug";

const colours: Record<LogLevel, string> = {
    info: "\x1b[36m",  // cyan
    warn: "\x1b[33m",  // yellow
    error: "\x1b[31m", // red
    debug: "\x1b[35m", // magenta
};

const reset = "\x1b[0m";

const timestamp = (): string => new Date().toISOString();

const log = (level: LogLevel, message: string, ...args: unknown[]): void => {
    const prefix = `${colours[level]}[${level.toUpperCase()}]${reset} ${timestamp()} -`;
    if (level === "error") {
        console.error(prefix, message, ...args);
    } else {
        console.log(prefix, message, ...args);
    }
};

export const logger = {
    info: (message: string, ...args: unknown[]) => log("info", message, ...args),
    warn: (message: string, ...args: unknown[]) => log("warn", message, ...args),
    error: (message: string, ...args: unknown[]) => log("error", message, ...args),
    debug: (message: string, ...args: unknown[]) => log("debug", message, ...args),
};
