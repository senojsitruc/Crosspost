// Minimal structured logging to stdout/stderr. systemd captures these into the journal.
function ts() {
  return new Date().toISOString();
}

export function info(msg, extra) {
  if (extra !== undefined) console.log(`${ts()} INFO  ${msg}`, JSON.stringify(extra));
  else console.log(`${ts()} INFO  ${msg}`);
}

export function warn(msg, extra) {
  if (extra !== undefined) console.warn(`${ts()} WARN  ${msg}`, JSON.stringify(extra));
  else console.warn(`${ts()} WARN  ${msg}`);
}

export function error(msg, err) {
  const detail = err instanceof Error ? `${err.message}\n${err.stack}` : JSON.stringify(err);
  console.error(`${ts()} ERROR ${msg}${err !== undefined ? ' ' + detail : ''}`);
}
