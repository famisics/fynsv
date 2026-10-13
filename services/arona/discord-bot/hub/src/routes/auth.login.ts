import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/login")({
  server: {
    handlers: {
      GET: async () => {
        const { handleLogin } = await import("../server/auth.server.ts");
        const { getApp } = await import("../server/app.server.ts");
        return handleLogin(getApp().config);
      },
    },
  },
});
