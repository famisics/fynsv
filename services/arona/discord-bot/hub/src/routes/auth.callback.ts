import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleCallback } = await import("../server/auth.server.ts");
        const { getApp } = await import("../server/app.server.ts");
        const { config, store } = getApp();
        return handleCallback(request, config, store);
      },
    },
  },
});
