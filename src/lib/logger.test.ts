import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, newRequestId, requestLogger } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("writes JSON lines tagged with the app name", () => {
    const { lines, stream } = capture();
    createLogger(stream).info("hello");
    expect(lines[0]).toMatchObject({ app: "jobhunt", msg: "hello" });
  });

  it("binds the request id on child loggers", () => {
    const { lines, stream } = capture();
    requestLogger("req-123", createLogger(stream)).info("in request");
    expect(lines[0]).toMatchObject({ requestId: "req-123", msg: "in request" });
  });

  it("generates unique request ids", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
