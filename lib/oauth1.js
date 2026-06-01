// OAuth 1.0a request signing (HMAC-SHA1), dependency-free.
// Used for posting to X as a single fixed user, where OAuth 1.0a access tokens
// are permanent and need no browser flow or refresh — simpler than OAuth 2.0.
//
// For JSON-body requests to the X v2 API, the body is NOT part of the signature
// base string; only the oauth_* params (and any query params) are signed.
import { createHmac, randomBytes } from 'node:crypto';

// RFC 3986 percent-encoding (encodeURIComponent leaves !*'() unescaped).
function pe(s) {
  return encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

export function oauth1Header({
  method,
  url,
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  extraParams = {},
  nonce,
  timestamp
}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp || Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: '1.0'
  };

  const allParams = { ...oauth, ...extraParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${pe(k)}=${pe(allParams[k])}`)
    .join('&');

  const baseString = [method.toUpperCase(), pe(url), pe(paramString)].join('&');
  const signingKey = `${pe(consumerSecret)}&${pe(tokenSecret)}`;
  oauth.oauth_signature = createHmac('sha1', signingKey).update(baseString).digest('base64');

  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pe(k)}="${pe(oauth[k])}"`)
      .join(', ')
  );
}
