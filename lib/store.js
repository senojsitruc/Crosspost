// Tiny JSON-file persistence with atomic writes. Two files:
//   tokens.json  - Reddit OAuth2 tokens (access token refreshed periodically).
//                  X is not stored here — it uses permanent OAuth 1.0a creds.
//   ledger.json  - record of which post IDs have been cross-posted (idempotency)
// Single-process service, so no locking needed beyond atomic rename.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKENS_PATH = join(ROOT, 'tokens.json');
const LEDGER_PATH = join(ROOT, 'ledger.json');

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

// ----- tokens -----
export function loadTokens() {
  return readJson(TOKENS_PATH, { x: null, reddit: null });
}

export function saveTokens(tokens) {
  writeJsonAtomic(TOKENS_PATH, tokens);
}

// Convenience: update one provider's tokens and persist immediately.
export function updateProviderTokens(provider, providerTokens) {
  const all = loadTokens();
  all[provider] = providerTokens;
  saveTokens(all);
  return all;
}

// ----- ledger (idempotency) -----
export function loadLedger() {
  return readJson(LEDGER_PATH, {});
}

export function alreadyPosted(postId) {
  const ledger = loadLedger();
  const entry = ledger[postId];
  // Considered "done" only if every enabled target previously succeeded.
  return entry || null;
}

export function recordResult(postId, results) {
  const ledger = loadLedger();
  ledger[postId] = {
    at: new Date().toISOString(),
    results
  };
  writeJsonAtomic(LEDGER_PATH, ledger);
}
