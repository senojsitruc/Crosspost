// Build per-platform post content from a Ghost post payload.
// The shared link renders the post's excerpt as a preview card (your site is
// members-only, so non-members see the excerpt teaser — good funnel behavior).

const X_LIMIT = 280;
// X counts every URL as a fixed 23 chars (t.co wrapping), regardless of length.
const X_URL_WEIGHT = 23;
const REDDIT_TITLE_LIMIT = 300;

export function postUrl(config, post) {
  // Prefer Ghost's canonical url if present; otherwise build from siteUrl + slug.
  if (post.url) return post.url;
  const base = config.siteUrl.replace(/\/$/, '');
  return `${base}/${post.slug}/`;
}

// Tweet text = excerpt + link. Falls back to the title when no excerpt is set
// (e.g. a post with no custom_excerpt) so we never tweet a bare URL. The lead
// text is trimmed only if it would overflow X's 280-char limit (URL counts 23).
export function buildXText({ title, excerpt, url }) {
  const sep = '\n\n';
  const budget = X_LIMIT - X_URL_WEIGHT - sep.length;
  let lead = (excerpt && excerpt.trim()) || (title || '').trim();
  if (lead.length > budget) lead = lead.slice(0, budget - 1).trimEnd() + '…';
  return `${lead}${sep}${url}`;
}

export function buildRedditTitle(title) {
  let t = title.trim();
  if (t.length > REDDIT_TITLE_LIMIT) t = t.slice(0, REDDIT_TITLE_LIMIT - 1).trimEnd() + '…';
  return t;
}
