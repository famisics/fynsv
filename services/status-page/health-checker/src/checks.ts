export interface CheckResult {
  status: "up" | "down";
  error?: string;
}

export async function httpCheck(
  url: string,
  timeoutMs: number,
  okStatuses?: number[],
): Promise<CheckResult> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (okStatuses && !okStatuses.includes(res.status)) {
      return { status: "down", error: `HTTP ${res.status}` };
    }
    return { status: "up" };
  } catch (e) {
    return {
      status: "down",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function tcpCheck(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<CheckResult> {
  return new Promise((resolve) => {
    let socket: { end(): void } | undefined;

    const timer = setTimeout(() => {
      socket?.end();
      resolve({ status: "down", error: "timeout" });
    }, timeoutMs);

    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(s) {
          clearTimeout(timer);
          socket = s;
          s.end();
          resolve({ status: "up" });
        },
        error(_s, err) {
          clearTimeout(timer);
          resolve({
            status: "down",
            error: err instanceof Error ? err.message : String(err),
          });
        },
        data() {},
        close() {},
      },
    }).catch((err) => {
      clearTimeout(timer);
      resolve({
        status: "down",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

export async function pingCheck(
  host: string,
  timeoutMs: number,
): Promise<CheckResult> {
  const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const proc = Bun.spawn(["ping", "-c", "1", "-W", String(waitSeconds), host], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  if (code === 0) {
    return { status: "up" };
  }
  return { status: "down", error: `ping exit ${code}` };
}

export async function dockerCheck(
  container: string,
  timeoutMs: number,
  socketPath = "/var/run/docker.sock",
): Promise<CheckResult> {
  try {
    const res = await fetch(`http://localhost/containers/${container}/json`, {
      unix: socketPath,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) {
      return { status: "down", error: "no such container" };
    }
    if (!res.ok) {
      return { status: "down", error: `Docker API HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      State?: { Running?: boolean; Health?: { Status?: string } };
    };
    if (!body.State?.Running) {
      return { status: "down", error: "container not running" };
    }
    const health = body.State.Health?.Status;
    if (health && health !== "healthy") {
      return { status: "down", error: `health status: ${health}` };
    }
    return { status: "up" };
  } catch (e) {
    return {
      status: "down",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
