import { describe, expect, test } from "bun:test";
import type { Service } from "./config";
import { fetchResourceStats } from "./proxmox";

describe("fetchResourceStats", () => {
  test("proxmox マッピングが無いサービスは null を返す", async () => {
    const service: Service = {
      id: "discord-bot",
      name: "Discord Bot",
      category: "internal",
      enabled: true,
      check: { type: "docker", container: "fun-council-bot-1", timeoutMs: 3000 },
    };

    const result = await fetchResourceStats(service);
    expect(result).toBeNull();
  });
});
