// Manually cross-post one URL, bypassing the webhook. Useful for testing and
// for re-running a post that failed its automatic fan-out.
//   node send-test.mjs "Post Title" "https://example.com/slug/" ["Excerpt text"]
// The X post leads with the excerpt (falls back to the title if omitted).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadTokens } from './lib/store.js';
import { postToX } from './lib/x.js';
import { postToReddit } from './lib/reddit.js';
import { postToFacebook } from './lib/facebook.js';
import { buildXText, buildRedditTitle } from './lib/message.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const title = process.argv[2];
const url = process.argv[3];
const excerpt = process.argv[4] || '';
if (!title || !url) {
  console.error('Usage: node send-test.mjs "Post Title" "https://example.com/slug/" ["Excerpt text"]');
  process.exit(1);
}

const tokens = loadTokens();
if (config.targets.x) {
  console.log('X  ->', await postToX(config, buildXText({ title, excerpt, url })).catch((e) => e.message));
}
if (config.targets.reddit) {
  console.log('Reddit ->', await postToReddit(config, tokens.reddit, { title: buildRedditTitle(title), url }).catch((e) => e.message));
}
if (config.targets.facebook) {
  console.log('Facebook ->', await postToFacebook(config, { message: excerpt || title, link: url }).catch((e) => e.message));
}
