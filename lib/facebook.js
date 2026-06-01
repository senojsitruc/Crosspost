// Facebook Page poster via the Graph API. Posts to /{page-id}/feed with a
// `message` (the excerpt) and a `link` (the post URL); Facebook renders the link
// as a preview card from the page's OpenGraph tags.
//
// Auth is a long-lived ("never-expiring") Page access token, generated once from
// a long-lived user token (see README). For posting to a Page you own/administer
// this needs only Standard Access — no App Review or Business Verification.
import { info, warn } from './log.js';

const GRAPH_VERSION = 'v23.0';

export async function postToFacebook(config, { message, link }) {
  if (config.dryRun) {
    info('[dryRun] would post to Facebook', { message, link });
    return { ok: true, dryRun: true };
  }

  const { pageId, pageAccessToken } = config.facebook || {};
  if (!pageId || !pageAccessToken || /PASTE|REPLACE/.test(pageId) || /PASTE|REPLACE/.test(pageAccessToken)) {
    throw new Error('Facebook not configured: set facebook.pageId and facebook.pageAccessToken');
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/feed`;
  const body = new URLSearchParams({ message, link, access_token: pageAccessToken });

  const res = await fetch(url, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    warn('Facebook post failed', { status: res.status, error: json.error || json });
    throw new Error(`Facebook post failed ${res.status}: ${JSON.stringify(json.error || json)}`);
  }
  // Response id is "{page-id}_{post-id}"
  info('Posted to Facebook', { id: json.id });
  return { ok: true, id: json.id, url: json.id ? `https://www.facebook.com/${json.id}` : undefined };
}
