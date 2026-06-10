// Pinterest poster using OAuth 2.0 (refresh-token flow). Creates a Pin on a board
// with an image (Pinterest REQUIRES media — unlike X/Reddit/FB, a link alone is
// not enough), a title, a description (the post excerpt) and a link back to the
// post. Pinterest fetches the image itself from a public image URL (the post's
// feature_image, or a configured fallback).
//
// NOTE: Pinterest ROTATES the refresh token on each refresh, so we persist the
// new refresh_token every time (Reddit's, by contrast, is permanent).
import { updateProviderTokens } from './store.js';
import { info, warn } from './log.js';

const AUTH_URL = 'https://www.pinterest.com/oauth/';
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
const PINS_URL = 'https://api.pinterest.com/v5/pins';
const BOARDS_URL = 'https://api.pinterest.com/v5/boards';

// boards:write is required to CREATE pins on a board (not just pins:write).
export const PINTEREST_SCOPES = ['boards:read', 'boards:write', 'pins:read', 'pins:write'];

// Build the Pinterest OAuth 2.0 authorize URL to send the user to "Allow".
export function authorizeUrl(config, state) {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', config.pinterest.clientId);
  u.searchParams.set('redirect_uri', config.pinterest.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', PINTEREST_SCOPES.join(','));
  u.searchParams.set('state', state);
  return u.toString();
}

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
      Authorization: basicAuth(config.pinterest.clientId, config.pinterest.clientSecret)
    },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Pinterest token refresh failed ${res.status}: ${JSON.stringify(json)}`);
  }
  const updated = {
    accessToken: json.access_token,
    // Pinterest returns a fresh refresh_token when rotation is enabled; keep the
    // existing one if the response omits it.
    refreshToken: json.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (json.expires_in ? json.expires_in * 1000 : 3600 * 1000)
  };
  updateProviderTokens('pinterest', updated);
  info('Pinterest access token refreshed');
  return updated;
}

// Exchange a one-time OAuth authorization `code` for tokens and persist them.
// Used by the /pinterest/callback endpoint so authorization completes in the
// browser with no copy/paste. Throws on failure; only writes on success.
export async function exchangeCode(config, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.pinterest.redirectUri
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(config.pinterest.clientId, config.pinterest.clientSecret)
    },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.refresh_token) {
    throw new Error(`Pinterest code exchange failed ${res.status}: ${JSON.stringify(json)}`);
  }
  const saved = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ? json.expires_in * 1000 : 3600 * 1000)
  };
  updateProviderTokens('pinterest', saved);
  info('Pinterest authorized via callback', { scope: json.scope, expiresIn: json.expires_in });
  return saved;
}

// List the authorizing account's boards, so the user can grab the numeric
// board_id to put in config.pinterest.boardId. Returns [{ id, name }].
export async function listBoards(accessToken) {
  const res = await fetch(BOARDS_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(json.items)) {
    throw new Error(`Pinterest list boards failed ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.items.map((b) => ({ id: b.id, name: b.name }));
}

async function ensureToken(config, tokens) {
  if (!tokens || !tokens.refreshToken) {
    throw new Error('Pinterest not authorized: run `node bootstrap-pinterest.mjs` first');
  }
  if (!tokens.accessToken || !tokens.expiresAt || Date.now() > tokens.expiresAt - 60000) {
    return refreshAccessToken(config, tokens);
  }
  return tokens;
}

export async function postToPinterest(config, tokens, { title, description, link, imageUrl }) {
  if (config.dryRun) {
    info('[dryRun] would post to Pinterest', { title, description, link, imageUrl });
    return { ok: true, dryRun: true };
  }
  const { boardId } = config.pinterest || {};
  if (!boardId || /PASTE|REPLACE/.test(boardId)) {
    throw new Error('Pinterest not configured: set pinterest.boardId');
  }
  if (!imageUrl) {
    // Should not happen: server.js falls back to config.pinterest.fallbackImageUrl.
    throw new Error('Pinterest needs an image: post has no feature_image and no fallbackImageUrl is set');
  }
  const fresh = await ensureToken(config, tokens);

  const payload = {
    board_id: boardId,
    title,
    description,
    link,
    media_source: { source_type: 'image_url', url: imageUrl }
  };
  const res = await fetch(PINS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${fresh.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) {
    warn('Pinterest pin failed', { status: res.status, json });
    throw new Error(`Pinterest pin failed ${res.status}: ${JSON.stringify(json)}`);
  }
  info('Posted to Pinterest', { id: json.id });
  return { ok: true, id: json.id, url: `https://www.pinterest.com/pin/${json.id}/` };
}
