import { describe, expect, test } from "bun:test";
import { services } from "./config";

function findService(id: string) {
  const s = services.find((s) => s.id === id);
  if (!s) throw new Error(`service not found: ${id}`);
  return s;
}

describe("arona 上の docker チェック対象サービス", () => {
  test("discord-bot は fun-council-bot-1 を docker チェックする", () => {
    const s = findService("discord-bot");
    expect(s.enabled).toBe(true);
    expect(s.check).toEqual({
      type: "docker",
      container: "fun-council-bot-1",
      timeoutMs: 3000,
    });
    expect(s.proxmox).toBeUndefined();
  });

  test("misskey-mixi2-link は misskey-mixi2-link-bridge-1 を docker チェックする", () => {
    const s = findService("misskey-mixi2-link");
    expect(s.enabled).toBe(true);
    expect(s.check).toEqual({
      type: "docker",
      container: "misskey-mixi2-link-bridge-1",
      timeoutMs: 3000,
    });
    expect(s.proxmox).toBeUndefined();
  });

  test("swarm-gcal-sync は swarm-gcal-sync-sync-1 を docker チェックする", () => {
    const s = findService("swarm-gcal-sync");
    expect(s.enabled).toBe(true);
    expect(s.check).toEqual({
      type: "docker",
      container: "swarm-gcal-sync-sync-1",
      timeoutMs: 3000,
    });
    expect(s.proxmox).toBeUndefined();
  });
});
