import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerCheck } from "./checks";

function startMockDockerd(respond: () => Response): {
  socketPath: string;
  server: ReturnType<typeof Bun.serve>;
  dir: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "dockerd-mock-"));
  const socketPath = join(dir, "docker.sock");
  const server = Bun.serve({
    unix: socketPath,
    fetch(req) {
      const match = new URL(req.url).pathname.match(
        /^\/containers\/([^/]+)\/json$/,
      );
      if (!match) return new Response("not found", { status: 404 });
      return respond();
    },
  });
  return { socketPath, server, dir };
}

describe("dockerCheck", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  test("up when container is running", async () => {
    const { socketPath, server, dir } = startMockDockerd(() =>
      Response.json({ State: { Running: true } }),
    );
    cleanup = () => {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    };

    const result = await dockerCheck("fun-council-bot-1", 1000, socketPath);
    expect(result).toEqual({ status: "up" });
  });

  test("down when container is stopped", async () => {
    const { socketPath, server, dir } = startMockDockerd(() =>
      Response.json({ State: { Running: false } }),
    );
    cleanup = () => {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    };

    const result = await dockerCheck("fun-council-bot-1", 1000, socketPath);
    expect(result.status).toBe("down");
    expect(result.error).toBe("container not running");
  });

  test("down when container does not exist", async () => {
    const { socketPath, server, dir } = startMockDockerd(
      () => new Response("no such container", { status: 404 }),
    );
    cleanup = () => {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    };

    const result = await dockerCheck("missing", 1000, socketPath);
    expect(result.status).toBe("down");
    expect(result.error).toBe("no such container");
  });

  test("down when container is running but unhealthy", async () => {
    const { socketPath, server, dir } = startMockDockerd(() =>
      Response.json({
        State: { Running: true, Health: { Status: "unhealthy" } },
      }),
    );
    cleanup = () => {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    };

    const result = await dockerCheck("fun-council-bot-1", 1000, socketPath);
    expect(result.status).toBe("down");
    expect(result.error).toBe("health status: unhealthy");
  });

  test("down when socket is unreachable", async () => {
    const result = await dockerCheck(
      "fun-council-bot-1",
      500,
      "/nonexistent/docker.sock",
    );
    expect(result.status).toBe("down");
    expect(result.error).toBeDefined();
  });
});
