# Crosspost

Automatically cross-post your **[Ghost](https://ghost.org)** blog posts to **X
(Twitter)**, a **Facebook Page**, **Reddit**, and **Pinterest** the moment you hit
publish.

It's a tiny, **dependency-free** Node service (Node 22 built-ins only — nothing to
`npm install`). Ghost fires a `post.published` webhook at it; it verifies the
request, builds a short teaser from the post's excerpt, and fans the post out to
each platform.

```
Ghost (post.published) ──webhook──▶ Crosspost ──┬─▶ X API (OAuth 1.0a)
                                                 ├─▶ Facebook Graph API
                                                 ├─▶ Reddit API (OAuth2)
                                                 └─▶ Pinterest API v5 (OAuth2)
```

## Features

- **Dependency-free** — pure Node 22 (`node:http`, `node:crypto`, `fetch`). No framework, no build step.
- **Verified** — checks Ghost's `X-Ghost-Signature` HMAC before acting (bad/missing signature → 401).
- **Excerpt-based** — uses each post's excerpt as the X text / Facebook caption, so you control the teaser (great for members-only blogs, where non-members see only the excerpt).
- **Skips backfill** — a configurable window (`maxBackdateMs`, default 6h) means publishing an old/backdated post won't spam your followers with stale content.
- **Idempotent** — records what it posted (`ledger.json`), so a webhook retry won't double-post.
- **Resilient** — acknowledges the webhook immediately, then posts in the background with retries; one platform failing doesn't block the others.
- **Per-target toggles** — enable/disable X, Facebook, Reddit, Pinterest independently.
- **Pinterest-aware** — Pins require an image, so each Pin uses the post's `feature_image` (or a configurable fallback) and links back to the post.

## The platform-access reality (as of 2026)

The code is the easy part; getting *permission* to post is where each platform
differs. This is what to expect:

| Platform | Cost | Setup friction | Auth |
|---|---|---|---|
| **X** | **Pay-per-use** — no free tier for new developers since Feb 2026; ~**$0.20 per post containing a URL** | Low — just attach billing | OAuth 1.0a (permanent tokens, no refresh — simplest for a single account) |
| **Reddit** | Free (non-commercial) | Medium — a one-time **API access application** is required, even for personal use | OAuth2 (refresh token) |
| **Facebook** | Free | **Low for your own Page** — see below | Never-expiring Page access token |
| **Pinterest** | Free | **Low for your own boards** — default *trial access* allows posting to boards you own; no app review needed | OAuth2 (refresh token, rotated each refresh) |

**Facebook is easier than its reputation.** Posting to a Page **you administer**
from **your own app** needs only **Standard Access** for `pages_manage_posts` (+
`pages_read_engagement`, `pages_show_list`), which Meta grants **without App Review
or Business Verification**. App Review + Business Verification are only required to
post to Pages you *don't* manage (Advanced Access).

**Pinterest needs an image for every Pin.** Unlike the other targets (which attach
a bare link and let the preview card render), the Pinterest API won't create a Pin
without media. Crosspost uses the post's `feature_image` as the Pin image, falling
back to `pinterest.fallbackImageUrl` so posts without a feature image still get
pinned. Pinterest's default *trial access* is enough to post to boards you own.

**Ghost won't deliver webhooks to `localhost`.** In production, Ghost blocks
webhook targets that resolve to a private/loopback IP (you'll see
`URL_PRIVATE_INVALID`). Run this service behind a public hostname — a reverse
proxy, or a tunnel (e.g. Cloudflare Tunnel) pointing at `127.0.0.1:<port>`. A host
that matches your Ghost site's host, or any hostname resolving to a public IP,
will be accepted. The endpoint stays safe because every request is HMAC-verified.

## Requirements

- Node.js 22+
- A self-hosted Ghost blog (to send the webhook)
- Credentials for whichever platforms you enable (see Setup)

## Setup

### 1. Configure

```bash
cp config.example.json config.json
chmod 600 config.json          # holds secrets
```

Generate a strong webhook secret and put it in `ghostWebhookSecret`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set `targets` to the platforms you want, and leave `dryRun: true` until you've
tested (in dry-run it logs what it *would* post without calling any API).

### 2. Get platform credentials

- **X** — create an app at <https://developer.x.com>, set **User authentication**
  to *Read and Write*, then from **Keys and tokens** copy the **API Key/Secret**
  (→ `consumerKey`/`consumerSecret`) and a generated **Access Token/Secret**
  (→ `accessToken`/`accessTokenSecret`). Generate the access token *after* setting
  Read and Write, or it will be read-only.
- **Facebook** — create a Business-type app at <https://developers.facebook.com>,
  grant `pages_manage_posts` (Standard Access), then mint a never-expiring **Page**
  token: get a short-lived user token from the Graph API Explorer with the page
  scopes → exchange it for a long-lived user token → `GET /me/accounts` and copy
  your Page's `access_token` and `id` into `facebook.pageAccessToken` /
  `facebook.pageId`.
- **Reddit** — apply for API access, create a **web app** at
  <https://www.reddit.com/prefs/apps> with redirect URI `http://localhost/callback`,
  fill the `reddit.*` fields, then run the one-time auth flow:
  ```bash
  node bootstrap-reddit.mjs   # opens an auth URL; paste the redirect back
  ```
- **Pinterest** — create an app at <https://developers.pinterest.com/apps/>, add a
  redirect URI that **exactly** matches `pinterest.redirectUri` (Pinterest requires
  HTTPS), and copy the **App ID/secret** into `pinterest.clientId`/`clientSecret`.
  Set `pinterest.fallbackImageUrl` to a hosted default cover image, then run the
  one-time auth flow:
  ```bash
  node bootstrap-pinterest.mjs   # opens an auth URL; paste the redirect back
  ```
  It saves the refresh token and prints your boards — copy the target board's id
  into `pinterest.boardId`.

### 3. Run it

```bash
node server.js
curl -s http://127.0.0.1:3737/health   # -> ok
```

Or install the included systemd unit (`crosspost.service`) — edit `User=` and the
paths first, then `systemctl enable --now crosspost`.

### 4. Point Ghost at it

In Ghost Admin → **Settings → Integrations → Add custom integration**, then add a
webhook:

- **Event:** Post published
- **Target URL:** your public endpoint, e.g. `https://hooks.example.com/hooks/ghost/post-published`
- **Secret:** the same value as `ghostWebhookSecret`

Publish a post (or flip `dryRun` off after testing) and watch the logs.

## Configuration

| Key | Purpose |
|---|---|
| `port`, `host` | Where the service listens (default `127.0.0.1:3737`) |
| `ghostWebhookSecret` | Shared secret for `X-Ghost-Signature` verification |
| `signatureToleranceMs` | Max age of a signed request (replay protection) |
| `maxBackdateMs` | Skip posts whose `published_at` is older than this (0 = post everything) |
| `dryRun` | If true, log intended posts without calling any API |
| `siteUrl` | Fallback base URL for building post links |
| `targets` | `{ x, reddit, facebook, pinterest }` booleans |
| `x`, `reddit`, `facebook`, `pinterest` | Per-platform credentials |

## Testing / re-posting

`send-test.mjs` posts a single URL to your enabled targets, bypassing the webhook
— handy for testing or re-running a post that failed:

```bash
node send-test.mjs "Post Title" "https://example.com/slug/" "Optional excerpt text"
```

## Security notes

- **`config.json` holds secrets** — it's git-ignored; never commit it. Keep it `chmod 600`.
- The webhook endpoint is public but **HMAC-verified** — unsigned requests get a 401.
- **File ownership:** if you run this as a service user (e.g. via systemd), that
  user must own the project directory, or the service will fail to read
  `config.json` / write `ledger.json` / `tokens.json`.

## Files

| File | Purpose |
|---|---|
| `server.js` | Webhook receiver + fan-out |
| `lib/verify.js` | Ghost `X-Ghost-Signature` HMAC verification |
| `lib/message.js` | Builds per-platform text (handles X's 280-char limit) |
| `lib/x.js` | X poster (v2 API, OAuth 1.0a) |
| `lib/oauth1.js` | OAuth 1.0a request signing |
| `lib/facebook.js` | Facebook Page poster (Graph API) |
| `lib/reddit.js` | Reddit poster (OAuth2, with token refresh) |
| `lib/pinterest.js` | Pinterest poster (API v5, OAuth2 with rotating refresh token) |
| `lib/store.js` | Token + idempotency-ledger persistence |
| `lib/log.js` | Minimal structured logging |
| `bootstrap-reddit.mjs` | One-time Reddit OAuth authorization |
| `bootstrap-pinterest.mjs` | One-time Pinterest OAuth authorization (also lists boards) |
| `send-test.mjs` | Manually post a URL to enabled targets |
| `config.example.json` | Config template (copy to `config.json`) |
| `crosspost.service` | systemd unit template |

## License

[MIT](LICENSE) © 2026 Curtis Jones
