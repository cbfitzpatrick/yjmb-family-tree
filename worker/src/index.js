const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
  if (origin && allowed && origin === allowed) return origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return allowed || origin || '*';
}

function cors(request, env) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
function b64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function b64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function fromB64(text) {
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function hmacBytes(secret, text) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}
async function signToken(payload, env) {
  const encoded = b64url(encoder.encode(JSON.stringify(payload)));
  const signature = b64url(await hmacBytes(env.SESSION_SIGNING_KEY, encoded));
  return `${encoded}.${signature}`;
}
async function verifyToken(token, env, type) {
  if (!token || !token.includes('.')) return null;
  const [encoded, supplied] = token.split('.', 2);
  const expected = await hmacBytes(env.SESSION_SIGNING_KEY, encoded);
  let got;
  try { got = fromB64url(supplied); } catch { return null; }
  if (got.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < got.length; i += 1) diff |= got[i] ^ expected[i];
  if (diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(decoder.decode(fromB64url(encoded))); } catch { return null; }
  if (payload.typ !== type || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
}
function acceptedAnswers(secretJson) {
  try {
    const parsed = JSON.parse(secretJson || '[]');
    return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
  } catch { return []; }
}
function answerAccepted(raw, accepted) {
  const value = normalize(raw);
  return accepted.some((fragment) => value.includes(fragment));
}
async function privacyKey(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return b64url(await hmacBytes(env.SESSION_SIGNING_KEY, `ip:${ip}`)).slice(0, 32);
}
async function kvCount(env, key, ttl) {
  if (!env.ABUSE_KV) return 1;
  const old = Number(await env.ABUSE_KV.get(key) || 0);
  const next = old + 1;
  await env.ABUSE_KV.put(key, String(next), { expirationTtl: ttl });
  return next;
}
async function authStage(request, env) {
  const body = await request.json().catch(() => ({}));
  const stage = Number(body.stage);
  if (![1, 2, 3].includes(stage)) return { body: { error: 'Invalid access stage.' }, status: 400 };
  const ipKey = await privacyKey(request, env);
  const failures = Number(env.ABUSE_KV ? await env.ABUSE_KV.get(`access-fail-hour:${ipKey}`) || 0 : 0);
  if (failures >= 12) return { body: { error: 'Too many access attempts.' }, status: 429 };
  if (stage > 1) {
    const flow = await verifyToken(String(body.flowToken || ''), env, 'flow');
    if (!flow || Number(flow.stage) !== stage - 1) return { body: { error: 'Access sequence expired. Start again.' }, status: 401 };
  }
  const accepted = acceptedAnswers(env[`ACCESS_STAGE_${stage}_JSON`]);
  if (!accepted.length) return { body: { error: 'Access service is not configured.' }, status: 503 };
  if (!answerAccepted(body.answer, accepted)) {
    await kvCount(env, `access-fail-hour:${ipKey}`, 3600);
    return { body: { error: 'Incorrect answer.' }, status: 401 };
  }
  const now = Math.floor(Date.now() / 1000);
  if (stage < 3) {
    return { body: { flowToken: await signToken({ typ: 'flow', stage, iat: now, exp: now + 600, nonce: crypto.randomUUID() }, env) }, status: 200 };
  }
  const accessToken = await signToken({ typ: 'access', iat: now, exp: now + 30 * 86400, jti: crypto.randomUUID() }, env);
  return { body: { accessToken, expiresIn: 30 * 86400 }, status: 200 };
}
async function requireAccess(request, env) {
  return verifyToken(bearer(request), env, 'access');
}
async function validateTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET) return { success: true, skipped: true };
  if (!token) return { success: false };
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!response.ok) return { success: false };
  return response.json();
}
function walkStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => walkStrings(v, out));
  return out;
}
async function scoreSubmission(payload, request, access, env) {
  const reasons = [];
  let score = 0;
  const serialized = JSON.stringify(payload);
  const self = payload?.self || {};
  const year = Number(self.ratYear);
  const current = new Date().getUTCFullYear();
  if (!String(self.givenPreferredName || '').trim() || !String(self.familyMaidenName || '').trim() || !Number.isInteger(year) || year < 1908 || year > current + 1) {
    return { hardReject: true, score: 99, reasons: ['Missing or invalid required identity/year fields.'] };
  }
  if (!Array.isArray(self.sections) || !self.sections.length) return { hardReject: true, score: 99, reasons: ['At least one section is required.'] };
  if (serialized.length > 60000) { score += 5; reasons.push('Submission payload is unusually large.'); }
  if (String(self.givenPreferredName).length > 80 || String(self.familyMaidenName).length > 100) { score += 3; reasons.push('Unusually long identity field.'); }
  if ((payload.rats || []).length > 8) { score += 2; reasons.push('Unusually large RAT list.'); }
  if ((self.sections || []).length > 4) { score += 1; reasons.push('Unusually large section history.'); }
  if (String(payload.favoriteTechBandMemory || '').length > 3000) { score += 2; reasons.push('Very long free-text memory.'); }
  if (Object.keys(payload.notes || {}).length > 8) { score += 1; reasons.push('Large number of third-party notes.'); }
  const suspicious = /<\s*script\b|javascript\s*:|data\s*:\s*text\/html|https?:\/\//i;
  if (walkStrings(payload).some((text) => suspicious.test(text))) { score += 4; reasons.push('Executable markup or external URL-like content detected.'); }

  const ipKey = await privacyKey(request, env);
  const hour = await kvCount(env, `submit-hour:${ipKey}`, 3600);
  const day = await kvCount(env, `submit-day:${ipKey}`, 86400);
  if (hour > 2) { score += 3; reasons.push('High submission frequency this hour.'); }
  if (day > 5) { score += 5; reasons.push('High submission frequency this day.'); }

  const identity = normalize(`${self.givenPreferredName}|${self.familyMaidenName}|${year}`);
  const fp = b64url(await hmacBytes(env.SESSION_SIGNING_KEY, `submission:${identity}`)).slice(0, 40);
  if (env.ABUSE_KV && await env.ABUSE_KV.get(`identity:${fp}`)) { score += 4; reasons.push('Repeated identity submission.'); }
  if (env.ABUSE_KV) await env.ABUSE_KV.put(`identity:${fp}`, access.jti || '1', { expirationTtl: 7 * 86400 });
  return { hardReject: false, score, reasons, fingerprint: fp };
}
async function encryptSubmission(value, env) {
  const keyBytes = fromB64(env.SUBMISSION_KEY_B64 || '');
  if (keyBytes.length !== 32) throw new Error('SUBMISSION_KEY_B64 must decode to 32 bytes.');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encoder.encode(JSON.stringify(value))));
  return { format: 'yjmb-secure-submission-v1', cipher: 'AES-256-GCM', iv: b64(iv), ciphertext: b64(ciphertext) };
}
async function github(path, options, env) {
  const owner = env.GITHUB_OWNER || 'cbfitzpatrick';
  const repo = env.GITHUB_REPO || 'yjmb-family-tree';
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'yjmb-family-tree-worker',
      ...(options?.headers || {}),
    },
  });
  const text = await response.text();
  let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.message || text}`);
  return body;
}
async function putEncryptedSubmission(id, route, encrypted, env) {
  const path = `.secure_submissions/${route}/${id}.enc.json`;
  const content = b64(encoder.encode(JSON.stringify(encrypted)));
  await github(`/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `Queue protected YJMB submission ${id}`, content, branch: env.GITHUB_BRANCH || 'main' }),
  }, env);
  return path;
}
async function createReviewIssue(id, path, score, reasons, env) {
  const assignees = env.ADMIN_GITHUB_USER ? [env.ADMIN_GITHUB_USER] : [];
  const safeReasons = reasons.length ? reasons.map((r) => `- ${r}`).join('\n') : '- Automated conflict/review routing.';
  return github('/issues', {
    method: 'POST',
    body: JSON.stringify({
      title: `[Protected submission review] ${id}`,
      body: `A protected YJMB tree submission was diverted from automatic application.\n\nEncrypted queue file: \`${path}\`\nRisk score: ${score}\n\nRouting reasons:\n${safeReasons}\n\nNo member-supplied profile data is included in this Issue. Review/decrypt the protected file locally before approving it.`,
      assignees,
    }),
  }, env);
}
async function submit(request, env, access) {
  const body = await request.json().catch(() => ({}));
  const turnstile = await validateTurnstile(String(body.turnstileToken || ''), request, env);
  if (!turnstile.success) return { body: { error: 'Abuse-prevention verification failed. Refresh and try again.' }, status: 403 };
  const payload = body.payload;
  if (!payload || typeof payload !== 'object') return { body: { error: 'Missing submission payload.' }, status: 400 };
  const risk = await scoreSubmission(payload, request, access, env);
  if (risk.hardReject) return { body: { error: 'Submission failed required field validation.' }, status: 400 };
  const id = crypto.randomUUID();
  const route = risk.score >= Number(env.REVIEW_SCORE_THRESHOLD || 3) ? 'review' : 'auto';
  const protectedValue = { id, receivedAt: new Date().toISOString(), risk: { score: risk.score, reasons: risk.reasons }, payload };
  const encrypted = await encryptSubmission(protectedValue, env);
  const path = await putEncryptedSubmission(id, route, encrypted, env);
  if (route === 'review') await createReviewIssue(id, path, risk.score, risk.reasons, env);
  return { body: { status: route, submissionId: id }, status: 200 };
}

export default {
  async fetch(request, env) {
    const common = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: common });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true }, 200, common);
      if (url.pathname === '/auth/stage' && request.method === 'POST') {
        const result = await authStage(request, env); return json(result.body, result.status, common);
      }
      if (url.pathname === '/session' && request.method === 'GET') {
        const access = await requireAccess(request, env); if (!access) return json({ error: 'Access session expired.' }, 401, common);
        return json({ ok: true, expiresAt: access.exp }, 200, common);
      }
      if (url.pathname === '/session/key' && request.method === 'GET') {
        const access = await requireAccess(request, env); if (!access) return json({ error: 'Access session expired.' }, 401, common);
        const key = fromB64(env.TREE_DATA_KEY_B64 || '');
        if (key.length !== 32) return json({ error: 'Tree key is not configured.' }, 503, common);
        return json({ dataKey: env.TREE_DATA_KEY_B64 }, 200, common);
      }
      if (url.pathname === '/submit' && request.method === 'POST') {
        const access = await requireAccess(request, env); if (!access) return json({ error: 'Access session expired.' }, 401, common);
        const result = await submit(request, env, access); return json(result.body, result.status, common);
      }
      return json({ error: 'Not found.' }, 404, common);
    } catch (error) {
      console.error(error);
      return json({ error: 'The protected service could not complete the request.' }, 500, common);
    }
  },
};
