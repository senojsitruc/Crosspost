// Cross-post service. Listens on localhost for a Ghost "Post published" webhook
// and fans out to X and Reddit. Dependency-free (Node 22 built-ins only).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { verifyGhostSignature } from './lib/verify.js';
import { loadTokens, alreadyPosted, recordResult } from './lib/store.js';
import { postToX } from './lib/x.js';
import { postToReddit } from './lib/reddit.js';
import { postToFacebook } from './lib/facebook.js';
import { postToPinterest, exchangeCode, listBoards, authorizeUrl } from './lib/pinterest.js';
import { postUrl, buildXText, buildRedditTitle, buildFacebookMessage, buildPinterest } from './lib/message.js';
import { info, warn, error } from './lib/log.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
const WEBHOOK_PATH = '/hooks/ghost/post-published';
const OAUTH_CALLBACK_PATH = '/pinterest/callback';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Minimal branded HTML shell. Generic on purpose (this file is a public
// template); the app name / site / copy come from runtime config.
function appName() { return config.landing?.appName || 'Crosspost'; }

function page(title, bodyHtml) {
  const site = (config.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${htmlEscape(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         max-width: 38rem; margin: 9vh auto; padding: 0 1.25rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 1.6rem 0 .4rem; }
  p { margin: .5rem 0; opacity: .92; }
  .lede { font-size: 1.15rem; opacity: 1; margin: 0 0 1rem; }
  ol, ul { padding-left: 1.2rem; } li { margin: .3rem 0; }
  .btn { display: inline-block; background: #e60023; color: #fff; text-decoration: none;
         padding: .75rem 1.3rem; border-radius: 999px; font-weight: 600;
         margin: 1rem 0; font-size: 1rem; }
  .btn:hover { background: #ad081b; }
  .muted { opacity: .6; font-size: .85rem; margin-top: 2.5rem; border-top: 1px solid rgba(128,128,128,.25); padding-top: 1rem; }
  .ok { color: #1a7f37; } .err { color: #b3261e; }
</style>
</head>
<body>
${bodyHtml}
<p class="muted">${htmlEscape(appName())}${site ? ' · ' + htmlEscape(site) : ''}. A personal tool that cross-posts new blog articles to the owner's own social accounts. It does not serve other users, show ads, or sell data.</p>
</body>
</html>`;
}

// Marketing-style landing page with a "Connect Pinterest" call to action that
// kicks off the OAuth flow. Copy is configurable via config.landing so this
// template file stays generic.
function renderLanding() {
  const l = config.landing || {};
  const name = htmlEscape(appName());
  const site = (config.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const tagline = htmlEscape(l.tagline || 'Automatic Pinterest cross-posting for my blog');
  const description = htmlEscape(
    l.description ||
    `${appName()} is a personal automation tool that publishes new posts from my blog${site ? ' (' + site + ')' : ''} to my own Pinterest board. It is built for my blog alone and does not post on anyone else's behalf.`
  );
  return page(name,
    `<h1>${name}</h1>
     <p class="lede">${tagline}</p>
     <p>${description}</p>
     <a class="btn" href="/connect/pinterest">Connect Pinterest</a>
     <h2>How it works</h2>
     <ol>
       <li>Connect the Pinterest account that owns your board.</li>
       <li>Choose the board that should receive new posts.</li>
       <li>Whenever a new article is published on the blog, ${name} automatically creates a Pin that links back to the article, using the post's featured image.</li>
     </ol>
     <h2>What ${name} can access</h2>
     <ul>
       <li><strong>View your boards</strong>, so you can pick which board receives new posts.</li>
       <li><strong>Create Pins</strong>, to add one Pin per new blog article to the board you chose.</li>
     </ul>
     <p>${name} never reads your personal information and only creates a Pin when a new blog post is published.</p>`);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// GET /pinterest/callback — the OAuth redirect target. Completes authorization
// server-side when Pinterest sends a `code`, and always renders a real 200 page
// (so the redirect URI never 404s — Pinterest checks this during app review).
async function handlePinterestCallback(reqUrl, res) {
  const params = new URL(reqUrl, 'http://localhost').searchParams;
  const code = params.get('code');
  const oauthError = params.get('error');

  if (oauthError) {
    const desc = params.get('error_description') || '';
    sendHtml(res, 200, page('Authorization not completed',
      `<h1 class="err">Authorization was not completed</h1>
       <p>Pinterest reported: <strong>${htmlEscape(oauthError)}</strong>${desc ? ' — ' + htmlEscape(desc) : ''}.</p>
       <p>You can close this window and try authorizing again.</p>`));
    return;
  }

  if (code) {
    try {
      const saved = await exchangeCode(config, code);
      // Convenience: show the account's boards so the user can copy the numeric
      // board_id into config. Non-fatal if it fails — auth already succeeded.
      let boardsHtml = '';
      try {
        const boards = await listBoards(saved.accessToken);
        if (boards.length) {
          boardsHtml = `<p>Your boards (put the id of the target board in <code>pinterest.boardId</code>):</p><ul>${
            boards.map((b) => `<li><code>${htmlEscape(b.id)}</code> — ${htmlEscape(b.name)}</li>`).join('')
          }</ul>`;
        }
      } catch (e) {
        warn('Pinterest board listing failed (non-fatal)', { message: e.message });
      }
      sendHtml(res, 200, page('Pinterest connected',
        `<h1 class="ok">Pinterest connected</h1>
         <p>Authorization completed and saved. You can close this window.</p>
         ${boardsHtml}`));
    } catch (e) {
      warn('Pinterest callback exchange failed', { message: e.message });
      sendHtml(res, 200, page('Authorization failed',
        `<h1 class="err">Could not complete authorization</h1>
         <p>The authorization code could not be exchanged. It may have expired or already been used. Please try authorizing again.</p>`));
    }
    return;
  }

  // No code and no error: a bare visit (e.g. a reviewer checking the URL).
  sendHtml(res, 200, page('Pinterest authorization',
    `<h1>Pinterest authorization endpoint</h1>
     <p>This is the OAuth 2.0 redirect URI for the site's Pinterest integration. After you approve access on Pinterest, you are returned here and the connection is finalized automatically.</p>
     <p>There is nothing to do on this page directly.</p>`));
}

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
      withRetry('Facebook', () => postToFacebook(config, { message: buildFacebookMessage({ title, excerpt, url }), link: url }))
        .then((r) => { results.facebook = { ok: true, ...r }; })
        .catch((e) => { results.facebook = { ok: false, error: e.message }; error('Facebook fan-out failed', e); })
    );
  }

  if (config.targets.pinterest) {
    // Pins require an image; use the post's feature_image, falling back to a
    // configured branded image so every post still gets pinned.
    const imageUrl = post.feature_image || config.pinterest?.fallbackImageUrl;
    const pin = buildPinterest({ title, excerpt });
    jobs.push(
      withRetry('Pinterest', () => postToPinterest(config, tokens.pinterest, { ...pin, link: url, imageUrl }))
        .then((r) => { results.pinterest = { ok: true, ...r }; })
        .catch((e) => { results.pinterest = { ok: false, error: e.message }; error('Pinterest fan-out failed', e); })
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

  if (req.method === 'GET' && req.url.split('?')[0] === OAUTH_CALLBACK_PATH) {
    await handlePinterestCallback(req.url, res);
    return;
  }

  // Start the Pinterest OAuth flow: redirect to Pinterest's "Allow" screen.
  if (req.method === 'GET' && req.url.split('?')[0] === '/connect/pinterest') {
    const state = randomBytes(16).toString('hex');
    res.writeHead(302, { Location: authorizeUrl(config, state) });
    res.end();
    return;
  }

  // The Pinterest integration landing page (with the "Connect Pinterest" CTA).
  if (req.method === 'GET' && req.url.split('?')[0] === '/pinterest') {
    sendHtml(res, 200, renderLanding());
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    const name = htmlEscape(appName());
    sendHtml(res, 200, page(name,
      `<h1>${name}</h1>
       <p class="lede">Personal cross-posting automation for my blog.</p>
       <p>New articles are automatically shared to my own social accounts.</p>
       <h2>Supported networks</h2>
       <ul>
         <li><a href="/pinterest">Pinterest</a>: creates a Pin linking back to each new article.</li>
         <li>X: posts a tweet with the article's excerpt and link.</li>
         <li>Facebook: shares the new article to my page.</li>
         <li>Reddit: submits the article link to my profile.</li>
       </ul>`));
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
