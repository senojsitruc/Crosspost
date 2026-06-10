// One-time Pinterest authorization helper.
//
// The crosspost service itself handles the OAuth redirect at
// `${redirectUri}` (GET /pinterest/callback): when you approve access,
// Pinterest sends you back there and the service exchanges the code, saves
// tokens.json, and shows your boards (so you can copy the board_id). So this
// script no longer does any code paste/exchange — it just builds the
// authorize URL for you to open.
//
// Prereqs (config.json pinterest block): clientId, clientSecret, redirectUri.
// Register the EXACT same redirectUri in your app at
// https://developers.pinterest.com/apps/ (Pinterest requires HTTPS + exact
// match), and make sure the crosspost service is running and reachable at that
// URL's host.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { authorizeUrl } from './lib/pinterest.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const state = randomBytes(16).toString('hex');

console.log('\n1) Open this URL in the browser logged into the target Pinterest account and click "Allow":\n');
console.log(authorizeUrl(config, state));
console.log(`\n2) Pinterest redirects you to ${config.pinterest.redirectUri}, which is served by the`);
console.log('   crosspost service. That page finalizes authorization automatically (saves tokens.json)');
console.log('   and lists your boards. Copy the desired board id into config.pinterest.boardId.\n');
console.log('No code to paste here — once the callback page says "Pinterest connected", you are done.\n');
