// Cross-post service. Listens on localhost for a Ghost "Post published" webhook
// and fans out to X and Reddit. Dependency-free (Node 22 built-ins only).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { verifyGhostSignature } from './lib/verify.js';
import { loadTokens, alreadyPosted, recordResult } from './lib/store.js';
import { postToX } from './lib/x.js';
import { postToReddit } from './lib/reddit.js';
import { postToFacebook } from './lib/facebook.js';
import { postUrl, buildXText, buildRedditTitle } from './lib/message.js';
import { info, warn, error } from './lib/log.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
const WEBHOOK_PATH = '/hooks/ghost/post-published';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function withRetry(label, fn, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      warn(`${label} attempt ${i}/${attempts} failed`, { message: err.message });
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
    }
  }
  throw lastErr;
}

// Fire-and-forget fan-out. Runs AFTER we've already returned 200 to Ghost,
// because Ghost retries are limited and we never want to block the webhook.
async function fanOut(post) {
  const title = post.title || '(untitled)';
  const excerpt = post.custom_excerpt || '';
  const url = postUrl(config, post);
  const tokens = loadTokens();
  const results = {};

  const jobs = [];
  if (config.targets.x) {
    jobs.push(
      withRetry('X', () => postToX(config, buildXText({ title, excerpt, url })))
        .then((r) => { results.x = { ok: true, ...r }; })
        .catch((e) => { results.x = { ok: false, error: e.message }; error('X fan-out failed', e); })
    );
  }
  if (config.targets.reddit) {
    jobs.push(
      withRetry('Reddit', () => postToReddit(config, tokens.reddit, { title: buildRedditTitle(title), url }))
        .then((r) => { results.reddit = { ok: true, ...r }; })
        .catch((e) => { results.reddit = { ok: false, error: e.message }; error('Reddit fan-out failed', e); })
    );
  }
  if (config.targets.facebook) {
    jobs.push(
      withRetry('Facebook', () => postToFacebook(config, { message: excerpt || title, link: url }))
        .then((r) => { results.facebook = { ok: true, ...r }; })
        .catch((e) => { results.facebook = { ok: false, error: e.message }; error('Facebook fan-out failed', e); })
    );
  }

  await Promise.allSettled(jobs);
  recordResult(post.id, results);
  info('Fan-out complete', { postId: post.id, title, results });
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method !== 'POST' || req.url !== WEBHOOK_PATH) {
    res.writeHead(404);
    res.end();
    return;
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    res.writeHead(413);
    res.end();
    return;
  }

  const verdict = verifyGhostSignature(
    raw,
    req.headers['x-ghost-signature'],
    config.ghostWebhookSecret,
    config.signatureToleranceMs
  );
  if (!verdict.ok) {
    warn('Rejected webhook', { reason: verdict.reason });
    res.writeHead(401);
    res.end();
    return;
  }

  let post;
  try {
    const payload = JSON.parse(raw);
    // Ghost wraps it as { post: { current: {...}, previous: {...} } }
    post = payload?.post?.current || payload?.post || payload;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  if (!post || !post.id) {
    res.writeHead(400);
    res.end();
    return;
  }

  // Only act on published posts (the webhook is post.published, but be defensive).
  if (post.status && post.status !== 'published') {
    info('Ignoring non-published post', { id: post.id, status: post.status });
    res.writeHead(200);
    res.end('ignored');
    return;
  }

  // Skip backfill: only cross-post articles whose publish date is "now-ish".
  // A backdated post (published_at set years/days in the past) is historical
  // content, not a fresh announcement, so we don't broadcast it.
  // Tune via config.maxBackdateMs (0 or negative disables the check).
  const maxBackdate = config.maxBackdateMs ?? 21600000; // default 6h
  if (maxBackdate > 0 && post.published_at) {
    const ageMs = Date.now() - Date.parse(post.published_at);
    if (Number.isFinite(ageMs) && ageMs > maxBackdate) {
      info('Ignoring backdated post', {
        id: post.id,
        published_at: post.published_at,
        ageHours: Math.round(ageMs / 3600000)
      });
      res.writeHead(200);
      res.end('ignored-backdated');
      return;
    }
  }

  // Idempotency: don't double-post if Ghost re-fires or the post is re-published.
  const prior = alreadyPosted(post.id);
  if (prior && Object.values(prior.results || {}).every((r) => r.ok)) {
    info('Already cross-posted, skipping', { id: post.id });
    res.writeHead(200);
    res.end('already-posted');
    return;
  }

  // Acknowledge immediately, then do the work in the background.
  res.writeHead(202);
  res.end('accepted');

  info('Accepted post for cross-posting', { id: post.id, title: post.title });
  fanOut(post).catch((e) => error('Unhandled fan-out error', e));
});

server.listen(config.port, config.host, () => {
  info(`crosspost listening on http://${config.host}:${config.port}${WEBHOOK_PATH}`, {
    dryRun: config.dryRun,
    targets: config.targets
  });
});
