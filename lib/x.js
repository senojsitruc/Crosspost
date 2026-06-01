// X (Twitter) poster using OAuth 1.0a user-context auth.
// For a single fixed account this is simpler than OAuth 2.0: the access token
// is permanent (generated in the dev portal), so there is no browser flow and
// no token refresh/rotation. Posts via the v2 endpoint POST /2/tweets.
//
// NOTE: As of Feb 2026 the X API is pay-per-use; a post containing a URL is
// billed at ~$0.20. Billing must be attached to the project in the X dev portal.
import { oauth1Header } from './oauth1.js';
import { info, warn } from './log.js';

const TWEETS_URL = 'https://api.twitter.com/2/tweets';

// text should already be within X's character limit (see buildMessages()).
export async function postToX(config, text) {
  if (config.dryRun) {
    info('[dryRun] would post to X', { text });
    return { ok: true, dryRun: true };
  }

  const { consumerKey, consumerSecret, accessToken, accessTokenSecret } = config.x;
  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    throw new Error('X not configured: need consumerKey, consumerSecret, accessToken, accessTokenSecret');
  }

  // JSON-body v2 requests: only the oauth_* params are signed (no body params).
  const authorization = oauth1Header({
    method: 'POST',
    url: TWEETS_URL,
    consumerKey,
    consumerSecret,
    token: accessToken,
    tokenSecret: accessTokenSecret
  });

  const res = await fetch(TWEETS_URL, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    warn('X post failed', { status: res.status, json });
    throw new Error(`X post failed ${res.status}: ${JSON.stringify(json)}`);
  }
  const id = json?.data?.id;
  info('Posted to X', { id });
  return { ok: true, id, url: id ? `https://x.com/i/web/status/${id}` : undefined };
}
