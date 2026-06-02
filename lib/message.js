// Build per-platform post content from a Ghost post payload.
// The shared link renders the post's excerpt as a preview card (your site is
// members-only, so non-members see the excerpt teaser — good funnel behavior).

const X_LIMIT = 280;
// X counts every URL as a fixed 23 chars (t.co wrapping), regardless of length.
const X_URL_WEIGHT = 23;
// Small margin below the hard 280 so we never land exactly on the boundary.
const X_SAFETY = 2;
const ELLIPSIS = '…';
const REDDIT_TITLE_LIMIT = 300;

// X's weighted character count: most code points count as 1, but anything
// outside its CJK-excluded ranges (incl. the ellipsis U+2026, emoji, etc.)
// counts as 2. Counting with JS string .length undercounts these and is what
// caused a "truncated" tweet to still come out 1 over 280 and get rejected.
function xWeight(str) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const countsAsOne =
      cp <= 4351 ||
      (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) ||
      (cp >= 8242 && cp <= 8247);
    w += countsAsOne ? 1 : 2;
  }
  return w;
}

export function postUrl(config, post) {
  // Prefer Ghost's canonical url if present; otherwise build from siteUrl + slug.
  if (post.url) return post.url;
  const base = config.siteUrl.replace(/\/$/, '');
  return `${base}/${post.slug}/`;
}

// Tweet text = excerpt + link. Falls back to the title when no excerpt is set
// (e.g. a post with no custom_excerpt) so we never tweet a bare URL. The lead
// is trimmed (at a word boundary, with an ellipsis) only if the whole tweet
// would exceed X's 280-char weighted limit. All length math uses xWeight(),
// not JS string length, so the ellipsis/emoji are counted exactly as X does.
export function buildXText({ title, excerpt, url }) {
  const sep = '\n\n';
  // Weight available for the lead text, leaving room for the separator, the
  // URL (always 23), and a small safety margin.
  const leadBudget = X_LIMIT - X_URL_WEIGHT - xWeight(sep) - X_SAFETY;
  const lead = (excerpt && excerpt.trim()) || (title || '').trim();

  if (xWeight(lead) <= leadBudget) return `${lead}${sep}${url}`;

  // Truncate by weighted length, reserving room for the ellipsis, then back up
  // to the last word boundary so we don't cut mid-word.
  const target = leadBudget - xWeight(ELLIPSIS);
  let out = '';
  let acc = 0;
  for (const ch of lead) {
    const w = xWeight(ch);
    if (acc + w > target) break;
    out += ch;
    acc += w;
  }
  const atWordBoundary = out.replace(/\s+\S*$/, '').trimEnd();
  out = atWordBoundary || out.trimEnd();
  return `${out}${ELLIPSIS}${sep}${url}`;
}

// Facebook Page post body: the full excerpt, a blank line, then an explicit
// "Read more:" call-to-action with the link. Facebook auto-links the raw URL
// (it can't hyperlink custom anchor text in a feed post) and still renders the
// preview card from it. No length cap needed (FB allows ~63k chars).
export function buildFacebookMessage({ title, excerpt, url }) {
  const lead = (excerpt && excerpt.trim()) || (title || '').trim();
  return `${lead}\n\nRead more: ${url}`;
}

export function buildRedditTitle(title) {
  let t = title.trim();
  if (t.length > REDDIT_TITLE_LIMIT) t = t.slice(0, REDDIT_TITLE_LIMIT - 1).trimEnd() + '…';
  return t;
}
