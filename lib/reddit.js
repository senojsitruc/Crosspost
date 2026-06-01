// Reddit poster using OAuth 2.0 (installed/web app, permanent refresh token).
// Posts a LINK submission to your own profile (subreddit "u_<username>").
// Reddit requires a descriptive, unique User-Agent or it will rate-limit/block.
import { updateProviderTokens } from './store.js';
import { info, warn } from './log.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const SUBMIT_URL = 'https://oauth.reddit.com/api/submit';

function basicAuth(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function refreshAccessToken(config, tokens) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(config.reddit.clientId, config.reddit.clientSecret),
      'User-Agent': config.reddit.userAgent
    },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Reddit token refresh failed ${res.status}: ${JSON.stringify(json)}`);
  }
  const updated = {
    accessToken: json.access_token,
    refreshToken: tokens.refreshToken, // permanent; does not rotate
    expiresAt: Date.now() + (json.expires_in ? json.expires_in * 1000 : 3600 * 1000)
  };
  updateProviderTokens('reddit', updated);
  info('Reddit access token refreshed');
  return updated;
}

async function ensureToken(config, tokens) {
  if (!tokens || !tokens.refreshToken) {
    throw new Error('Reddit not authorized: run `npm run bootstrap:reddit` first');
  }
  if (!tokens.accessToken || !tokens.expiresAt || Date.now() > tokens.expiresAt - 60000) {
    return refreshAccessToken(config, tokens);
  }
  return tokens;
}

export async function postToReddit(config, tokens, { title, url }) {
  if (config.dryRun) {
    info('[dryRun] would post to Reddit', { title, url });
    return { ok: true, dryRun: true };
  }
  const fresh = await ensureToken(config, tokens);
  const form = new URLSearchParams({
    api_type: 'json',
    kind: 'link',
    sr: `u_${config.reddit.username}`,
    title,
    url,
    resubmit: 'true',
    sendreplies: 'false'
  });
  const res = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${fresh.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': config.reddit.userAgent
    },
    body: form
  });
  const json = await res.json().catch(() => ({}));
  // Reddit returns 200 even on logical errors; check the errors array.
  const errors = json?.json?.errors;
  if (!res.ok || (Array.isArray(errors) && errors.length)) {
    warn('Reddit submit failed', { status: res.status, json });
    throw new Error(`Reddit submit failed: ${JSON.stringify(errors || json)}`);
  }
  const data = json?.json?.data;
  info('Posted to Reddit', { url: data?.url, id: data?.name });
  return { ok: true, id: data?.name, url: data?.url };
}
