import { getEnabledServices, services, type Service } from "./config";
import { httpCheck, pingCheck, tcpCheck, type CheckResult } from "./checks";
import { fetchResourceStats, type ResourceStats } from "./proxmox";
import { cleanOldRecords, initDb, insertSnapshot, syncServiceMeta } from "./db";

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
    case "docker":
      return Promise.resolve({ status: "down", error: "docker check not yet wired" });
  }
}

async function tick(): Promise<void> {
  const services = getEnabledServices();
  const now = new Date().toISOString();

  const [checks, resources] = await Promise.all([
    Promise.allSettled(services.map(runCheck)),
    Promise.allSettled(services.map(fetchResourceStats)),
  ]);

  const serviceData: Record<string, Record<string, unknown>> = {};
  let up = 0;
  let down = 0;

  services.forEach((service, i) => {
    const entry: Record<string, unknown> = {};

    const checkResult = checks[i];
    if (checkResult.status === "fulfilled") {
      const r = checkResult.value;
      r.status === "up" ? up++ : down++;
      entry.status = r.status;
      entry.error = r.error ?? null;
    } else {
      down++;
      entry.status = "down";
      entry.error = String(checkResult.reason);
    }

    const resourceResult = resources[i];
    if (resourceResult.status === "fulfilled" && resourceResult.value) {
      Object.assign(entry, resourceResult.value);
    }

    serviceData[service.id] = entry;
  });

  await insertSnapshot({ services: serviceData }, now);
  console.log(`[${now}] checked ${services.length} services: ${up} up, ${down} down`);
}

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastCleanup = 0;

async function maybeCleanup(): Promise<void> {
  if (Date.now() - lastCleanup < CLEANUP_INTERVAL_MS) return;
  await cleanOldRecords(90);
  lastCleanup = Date.now();
  console.log(`[${new Date().toISOString()}] cleaned records older than 90 days`);
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
  await syncServiceMeta(services);
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
console.log(`PVE_API_TOKEN: ${process.env.PVE_API_TOKEN ? "set" : "NOT SET"}`);
loop().catch((e) => console.error("loop crashed:", e));
