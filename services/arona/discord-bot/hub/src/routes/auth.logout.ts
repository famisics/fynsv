import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleLogout } = await import("../server/auth.server.ts");
        const { getApp } = await import("../server/app.server.ts");
        const { config, store } = getApp();
        return handleLogout(request, config, store);
      },
    },
  },
});
