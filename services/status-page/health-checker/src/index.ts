import { getEnabledServices, type Service } from "./config";
import { httpCheck, pingCheck, tcpCheck, type CheckResult } from "./checks";
import { fetchResourceStats } from "./proxmox";
import {
  cleanOldRecords,
  initDb,
  insertCheckResult,
  insertResourceSnapshot,
} from "./db";

const PORT = 8090;
const INTERVAL_MS = 60_000;

function runCheck(service: Service): Promise<CheckResult> {
  const { check } = service;
  switch (check.type) {
    case "http":
      return httpCheck(check.url!, check.timeoutMs, check.okStatuses);
    case "tcp":
      return tcpCheck(check.host!, check.port!, check.timeoutMs);
    case "ping":
      return pingCheck(check.host!, check.timeoutMs);
  }
}

async function tick(): Promise<void> {
  const services = getEnabledServices();
  const now = new Date().toISOString();

  const [checks, resources] = await Promise.all([
    Promise.allSettled(services.map(runCheck)),
    Promise.allSettled(services.map(fetchResourceStats)),
  ]);

  const writes: Promise<void>[] = [];
  let up = 0;
  let down = 0;

  services.forEach((service, i) => {
    const checkResult = checks[i];
    if (checkResult.status === "fulfilled") {
      const r = checkResult.value;
      r.status === "up" ? up++ : down++;
      writes.push(insertCheckResult(service.id, r, now));
    } else {
      down++;
      writes.push(
        insertCheckResult(
          service.id,
          { status: "down", latency_ms: 0, error: String(checkResult.reason) },
          now,
        ),
      );
    }

    const resourceResult = resources[i];
    if (resourceResult.status === "fulfilled" && resourceResult.value) {
      writes.push(insertResourceSnapshot(service.id, resourceResult.value, now));
    }
  });

  await Promise.allSettled(writes);
  console.log(`[${now}] checked ${services.length} services: ${up} up, ${down} down`);
}

async function maybeCleanup(): Promise<void> {
  const now = new Date();
  if (now.getHours() === 4 && now.getMinutes() === 0) {
    await cleanOldRecords(90);
    console.log(`[${now.toISOString()}] cleaned records older than 90 days`);
  }
}

async function loop(): Promise<void> {
  while (true) {
    try {
      await initDb();
      break;
    } catch (e) {
      console.error("initDb failed, retrying in 10s:", e);
      await Bun.sleep(10_000);
    }
  }
  console.log("db initialized, starting check loop");
  while (true) {
    await tick().catch((e) => console.error("tick failed:", e));
    await maybeCleanup().catch((e) => console.error("cleanup failed:", e));
    await Bun.sleep(INTERVAL_MS);
  }
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return new Response("OK", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`health-checker listening on :${PORT}`);
loop().catch((e) => console.error("loop crashed:", e));
