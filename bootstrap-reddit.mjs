// One-time: obtain a Reddit OAuth 2.0 permanent refresh token.
// Run interactively:  node bootstrap-reddit.mjs
// Register a "web app" at https://www.reddit.com/prefs/apps with the same redirect URI.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { updateProviderTokens } from './lib/store.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const AUTH_URL = 'https://www.reddit.com/api/v1/authorize';
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const SCOPES = ['submit', 'identity'];

const state = randomBytes(16).toString('hex');
const authUrl = new URL(AUTH_URL);
authUrl.searchParams.set('client_id', config.reddit.clientId);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('redirect_uri', config.reddit.redirectUri);
authUrl.searchParams.set('duration', 'permanent');
authUrl.searchParams.set('scope', SCOPES.join(' '));

console.log('\n1) Open this URL in your browser and click "Allow":\n');
console.log(authUrl.toString());
console.log(`\n2) You will be redirected to ${config.reddit.redirectUri} (the page may fail to load — fine).`);
console.log('   Copy the full redirected URL, or just the ?code= value.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Paste redirected URL or code: ')).trim();
rl.close();

let code = answer;
try {
  const u = new URL(answer);
  if (u.searchParams.get('code')) code = u.searchParams.get('code');
} catch { /* raw code */ }
// Reddit appends a "#_" fragment sometimes; strip trailing junk.
code = code.replace(/#.*$/, '');

const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code,
  redirect_uri: config.reddit.redirectUri
});

const res = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Basic ' + Buffer.from(`${config.reddit.clientId}:${config.reddit.clientSecret}`).toString('base64'),
    'User-Agent': config.reddit.userAgent
  },
  body
});
const json = await res.json().catch(() => ({}));
if (!res.ok || !json.refresh_token) {
  console.error('\nToken exchange failed:', res.status, JSON.stringify(json, null, 2));
  if (!json.refresh_token) console.error('No refresh_token — ensure duration=permanent and a "web app" type.');
  process.exit(1);
}

updateProviderTokens('reddit', {
  accessToken: json.access_token,
  refreshToken: json.refresh_token,
  expiresAt: Date.now() + (json.expires_in ? json.expires_in * 1000 : 3600 * 1000)
});

console.log('\n✓ Reddit authorized. Permanent refresh token saved to tokens.json.');
