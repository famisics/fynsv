import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { type Deps, createApi } from "./api.ts";
import { createAuthRoutes } from "./auth.ts";

export function createApp(deps: Deps) {
  return new Hono()
    .get("/healthz", (c) => c.text("ok"))
    .route("/auth", createAuthRoutes(deps.config, deps.store))
    .route("/api", createApi(deps))
    .all("/api/*", (c) => c.json({ error: "not_found" }, 404))
    .use("*", serveStatic({ root: "./web/dist" }))
    // SPA のルーティング用。未知のパスは index.html を返す
    .get("*", serveStatic({ path: "./web/dist/index.html" }));
}
