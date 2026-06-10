// Manually post one blog URL to Pinterest, bypassing the webhook. Mirrors the
// Pinterest fan-out in server.js (postToPinterest with buildPinterest payload),
// but pulls the post's title / excerpt / feature image from the page's
// OpenGraph tags instead of a webhook payload. Must run as the `ghost` user so
// it can read/refresh tokens.json.
//   node send-test-pinterest.mjs "https://example.com/slug/"
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadTokens } from './lib/store.js';
import { postToPinterest } from './lib/pinterest.js';
import { buildPinterest } from './lib/message.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const url = process.argv[2];
if (!url) {
  console.error('Usage: node send-test-pinterest.mjs "https://example.com/slug/"');
  process.exit(1);
}

// Pull og: metadata so this matches what the webhook payload would carry
// (post.title / post.custom_excerpt / post.feature_image).
const html = await (await fetch(url)).text();
const og = (prop) => {
  const m = html.match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`, 'i'));
  return m ? m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
};
const title = og('title');
const excerpt = og('description');
const imageUrl = og('image') || config.pinterest?.fallbackImageUrl;

const pin = buildPinterest({ title, excerpt });
console.log('About to post to Pinterest:');
console.log(JSON.stringify({ ...pin, link: url, imageUrl, boardId: config.pinterest?.boardId }, null, 2));

const tokens = loadTokens();
const result = await postToPinterest(config, tokens.pinterest, { ...pin, link: url, imageUrl })
  .catch((e) => ({ ok: false, error: e.message }));
console.log('\nPinterest ->', JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
