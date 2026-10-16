import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/lib/logger");
  const header = request.headers["x-request-id"];
  const err = error as Error;
  logger.error(
    {
      err: { message: err.message, stack: err.stack },
      path: request.path,
      method: request.method,
      requestId: Array.isArray(header) ? header[0] : header,
    },
    "request error",
  );
};
