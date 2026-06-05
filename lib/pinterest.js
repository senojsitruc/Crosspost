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

const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
const PINS_URL = 'https://api.pinterest.com/v5/pins';

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
