import { createServerFn } from "@tanstack/react-start";
import { currentSession } from "../authz.server.ts";

// 未ログインなら null
export const getMe = createServerFn().handler(async () => {
  const session = currentSession();
  return session ? { id: session.userId, username: session.username, avatarUrl: session.avatarUrl } : null;
});
