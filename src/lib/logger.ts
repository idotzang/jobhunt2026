import pino from "pino";

export const REQUEST_ID_HEADER = "x-request-id";

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  const options: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL ?? "info",
    base: { app: "jobhunt" },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

export function requestLogger(requestId: string, base: pino.Logger = logger): pino.Logger {
  return base.child({ requestId });
}
