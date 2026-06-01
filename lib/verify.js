// Verify Ghost's X-Ghost-Signature header.
// Ghost signs HMAC-SHA256 over (rawBody + timestamp), where timestamp is ms.
// Header format: "sha256=<hex>, t=<ms>"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyGhostSignature(rawBody, header, secret, toleranceMs) {
  if (!header) return { ok: false, reason: 'missing X-Ghost-Signature header' };

  const sigMatch = /sha256=([a-f0-9]+)/i.exec(header);
  const tMatch = /t=(\d+)/.exec(header);
  if (!sigMatch || !tMatch) return { ok: false, reason: 'malformed signature header' };

  const provided = sigMatch[1].toLowerCase();
  const timestamp = tMatch[1];

  if (toleranceMs && toleranceMs > 0) {
    const age = Math.abs(Date.now() - Number(timestamp));
    if (age > toleranceMs) return { ok: false, reason: `timestamp outside tolerance (${age}ms)` };
  }

  const expected = createHmac('sha256', secret)
    .update(rawBody + timestamp, 'utf8')
    .digest('hex');

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
}
