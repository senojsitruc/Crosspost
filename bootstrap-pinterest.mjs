// One-time: obtain a Pinterest OAuth 2.0 refresh token, then list your boards so
// you can copy the board_id into config.json.
// Run interactively:  node bootstrap-pinterest.mjs
//
// Prereqs (in config.json pinterest block): clientId, clientSecret, redirectUri.
// Register an app at https://developers.pinterest.com/apps/ and add the EXACT
// same redirect URI there (Pinterest requires HTTPS and an exact match).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { updateProviderTokens } from './lib/store.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const AUTH_URL = 'https://www.pinterest.com/oauth/';
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
const BOARDS_URL = 'https://api.pinterest.com/v5/boards';
// Read boards (to fetch board_id) + read/write pins.
const SCOPES = ['boards:read', 'pins:read', 'pins:write'];

function basicAuth() {
  return 'Basic ' + Buffer.from(`${config.pinterest.clientId}:${config.pinterest.clientSecret}`).toString('base64');
}

const state = randomBytes(16).toString('hex');
const authUrl = new URL(AUTH_URL);
authUrl.searchParams.set('client_id', config.pinterest.clientId);
authUrl.searchParams.set('redirect_uri', config.pinterest.redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(','));
authUrl.searchParams.set('state', state);

console.log('\n1) Open this URL in the browser where you are logged into the NEW Pinterest account, and click "Allow":\n');
console.log(authUrl.toString());
console.log(`\n2) You will be redirected to ${config.pinterest.redirectUri} (the page may fail to load — fine).`);
console.log('   Copy the full redirected URL, or just the ?code= value.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Paste redirected URL or code: ')).trim();
rl.close();

let code = answer;
try {
  const u = new URL(answer);
  if (u.searchParams.get('code')) code = u.searchParams.get('code');
} catch { /* raw code */ }
code = code.replace(/#.*$/, '');

const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code,
  redirect_uri: config.pinterest.redirectUri
});

const res = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: basicAuth()
  },
  body
});
const json = await res.json().catch(() => ({}));
if (!res.ok || !json.refresh_token) {
  console.error('\nToken exchange failed:', res.status, JSON.stringify(json, null, 2));
  process.exit(1);
}

updateProviderTokens('pinterest', {
  accessToken: json.access_token,
  refreshToken: json.refresh_token,
  expiresAt: Date.now() + (json.expires_in ? json.expires_in * 1000 : 3600 * 1000)
});
console.log('\n✓ Pinterest authorized. Refresh token saved to tokens.json.');

// Convenience: list boards so you can copy the board_id into config.json.
try {
  const b = await fetch(BOARDS_URL, { headers: { Authorization: `Bearer ${json.access_token}` } });
  const boards = await b.json().catch(() => ({}));
  if (b.ok && Array.isArray(boards.items)) {
    console.log('\nYour boards (copy the id of the target board into config.pinterest.boardId):');
    for (const board of boards.items) console.log(`  ${board.id}  ${board.name}`);
  } else {
    console.log('\n(Could not list boards automatically; fetch GET /v5/boards manually.)', JSON.stringify(boards));
  }
} catch (e) {
  console.log('\n(Board listing failed; not fatal.)', e.message);
}
