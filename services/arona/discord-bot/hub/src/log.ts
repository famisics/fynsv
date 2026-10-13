type Fields = Record<string, unknown>;

function write(level: string, msg: string, fields: Fields) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === "ERROR") console.error(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields: Fields = {}) => write("INFO", msg, fields),
  warn: (msg: string, fields: Fields = {}) => write("WARN", msg, fields),
  error: (msg: string, fields: Fields = {}) => write("ERROR", msg, fields),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
