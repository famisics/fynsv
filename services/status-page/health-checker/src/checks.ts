export interface CheckResult {
  status: "up" | "down";
  latency_ms: number;
  error?: string;
}

export async function httpCheck(
  url: string,
  timeoutMs: number,
  okStatuses?: number[],
): Promise<CheckResult> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    const latency_ms = performance.now() - start;
    if (okStatuses && !okStatuses.includes(res.status)) {
      return { status: "down", latency_ms, error: `HTTP ${res.status}` };
    }
    return { status: "up", latency_ms };
  } catch (e) {
    return {
      status: "down",
      latency_ms: performance.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function tcpCheck(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<CheckResult> {
  const start = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    let connected: { end(): void } | undefined;
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      connected?.end();
      finish({
        status: "down",
        latency_ms: performance.now() - start,
        error: "timeout",
      });
    }, timeoutMs);

    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(s) {
          clearTimeout(timer);
          connected = s;
          s.end();
          finish({ status: "up", latency_ms: performance.now() - start });
        },
        error(_s, err) {
          clearTimeout(timer);
          finish({
            status: "down",
            latency_ms: performance.now() - start,
            error: err instanceof Error ? err.message : String(err),
          });
        },
        data() {},
        close() {},
      },
    }).catch((err) => {
      clearTimeout(timer);
      finish({
        status: "down",
        latency_ms: performance.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

export async function pingCheck(
  host: string,
  timeoutMs: number,
): Promise<CheckResult> {
  const start = performance.now();
  const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const proc = Bun.spawn(["ping", "-c", "1", "-W", String(waitSeconds), host], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  const latency_ms = performance.now() - start;
  if (code === 0) {
    return { status: "up", latency_ms };
  }
  return { status: "down", latency_ms, error: `ping exit ${code}` };
}
