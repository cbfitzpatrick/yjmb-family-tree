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
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Developer-Key',
    'Access-Control-Expose-Headers': 'Content-Disposition',
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

async function constantTimeTextEqual(left, right) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(left ?? ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(right ?? ''))),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
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
  const kind = normalize(payload?.kind || 'addition');
  const current = new Date().getUTCFullYear();

  if (kind === 'correction') {
    if (!/^row-\d+$/.test(String(payload?.personId || '')) || !Array.isArray(payload?.changes) || payload.changes.length === 0) {
      return { hardReject: true, score: 99, reasons: ['Correction is missing a valid person ID or field changes.'] };
    }
    if (payload.changes.length > 80) { score += 4; reasons.push('Correction edits an unusually large number of fields.'); }
  } else {
    const self = payload?.self || {};
    const year = Number(self.ratYear);
    if (!String(self.givenPreferredName || '').trim() || !String(self.familyMaidenName || '').trim() || !Number.isInteger(year) || year < 1908 || year > current + 1) {
      return { hardReject: true, score: 99, reasons: ['Missing or invalid required identity/year fields.'] };
    }
    if (!Array.isArray(self.sections) || !self.sections.length) return { hardReject: true, score: 99, reasons: ['At least one section is required.'] };
    if (String(self.givenPreferredName).length > 80 || String(self.familyMaidenName).length > 100) { score += 3; reasons.push('Unusually long identity field.'); }
    if ((payload.rats || []).length > 8) { score += 2; reasons.push('Unusually large RAT list.'); }
    if ((self.sections || []).length > 4) { score += 1; reasons.push('Unusually large section history.'); }
    if (String(payload.favoriteTechBandMemory || '').length > 3000) { score += 2; reasons.push('Very long free-text memory.'); }
    if (Object.keys(payload.notes || {}).length > 8) { score += 1; reasons.push('Large number of profile notes.'); }
  }

  if (serialized.length > 80000) { score += 5; reasons.push('Submission payload is unusually large.'); }
  const suspicious = /<\s*script\b|javascript\s*:|data\s*:\s*text\/html/i;
  if (walkStrings(payload).some((text) => suspicious.test(text))) {
    return { hardReject: true, score: 99, reasons: ['Executable markup was detected.'] };
  }

  const ipKey = await privacyKey(request, env);
  const hour = await kvCount(env, `submit-hour:${ipKey}`, 3600);
  const day = await kvCount(env, `submit-day:${ipKey}`, 86400);
  if (hour > 4) { score += 3; reasons.push('High submission frequency this hour.'); }
  if (day > 12) { score += 5; reasons.push('High submission frequency this day.'); }

  // v17 does not make normal members wait for admin approval. Risk scoring is
  // retained as audit metadata; structural conflicts can still be held by the
  // workbook updater instead of overwriting conflicting data.
  return { hardReject: false, score, reasons, fingerprint: access?.jti || '' };
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

async function githubContent(path, env, { method = 'GET', body = null, allow404 = false } = {}) {
  const owner = env.GITHUB_OWNER || 'cbfitzpatrick';
  const repo = env.GITHUB_REPO || 'yjmb-family-tree';
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  const branch = env.GITHUB_BRANCH || 'main';
  const suffix = method === 'GET' ? `?ref=${encodeURIComponent(branch)}` : '';
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${suffix}`,
    {
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yjmb-family-tree-worker',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const responseText = await response.text();
  let parsed = {};
  try { parsed = responseText ? JSON.parse(responseText) : {}; } catch { parsed = { raw: responseText }; }
  if (response.status === 404 && allow404) return null;
  if (!response.ok) throw new Error(`GitHub contents API ${response.status}: ${parsed.message || responseText}`);
  return parsed;
}

async function getRepositoryTextFile(path, env) {
  const item = await githubContent(path, env);
  if (!item || Array.isArray(item) || !item.content) throw new Error(`Repository file ${path} did not contain file content.`);
  return decoder.decode(fromB64(String(item.content).replace(/\s+/g, '')));
}

async function listRepositoryDirectory(path, env) {
  const listing = await githubContent(path, env, { allow404: true });
  if (listing === null) return [];
  if (!Array.isArray(listing)) throw new Error(`${path} is not a repository directory.`);
  return listing;
}

async function putRepositoryTextFile(path, text, env, message) {
  const existing = await githubContent(path, env, { allow404: true });
  const body = {
    message,
    content: b64(encoder.encode(text)),
    branch: env.GITHUB_BRANCH || 'main',
  };
  if (existing?.sha) body.sha = existing.sha;
  return githubContent(path, env, { method: 'PUT', body });
}

async function deleteRepositoryFile(path, sha, env, message) {
  return githubContent(path, env, {
    method: 'DELETE',
    body: { message, sha, branch: env.GITHUB_BRANCH || 'main' },
  });
}

async function decryptMasterWorkbookEnvelope(envelopeText, env) {
  const keyBytes = fromB64(env.MASTER_WORKBOOK_KEY_B64 || '');
  if (keyBytes.length !== 32) throw new Error('MASTER_WORKBOOK_KEY_B64 must decode to 32 bytes.');
  let envelope;
  try { envelope = JSON.parse(envelopeText); } catch { throw new Error('Protected master workbook envelope is invalid JSON.'); }
  if (envelope.format !== 'yjmb-master-workbook-v1' || envelope.cipher !== 'AES-256-GCM') {
    throw new Error('Unsupported protected master workbook format.');
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(envelope.iv || ''), tagLength: 128 },
    key,
    fromB64(envelope.ciphertext || ''),
  );
  return new Uint8Array(plaintext);
}

async function decryptSubmissionEnvelope(envelope, env) {
  if (!envelope || envelope.format !== 'yjmb-secure-submission-v1' || envelope.cipher !== 'AES-256-GCM') {
    throw new Error('Unsupported protected submission format.');
  }
  const keyBytes = fromB64(env.SUBMISSION_KEY_B64 || '');
  if (keyBytes.length !== 32) throw new Error('SUBMISSION_KEY_B64 must decode to 32 bytes.');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(envelope.iv || ''), tagLength: 128 },
    key,
    fromB64(envelope.ciphertext || ''),
  );
  return JSON.parse(decoder.decode(new Uint8Array(plaintext)));
}

async function developerKeyAccepted(request, env, { countFailure = true } = {}) {
  const configuredKey = String(env.DEVELOPER_EXPORT_KEY || '');
  if (configuredKey.length < 32) return { ok: false, status: 503, error: 'Developer authorization is not configured.' };
  const ipKey = await privacyKey(request, env);
  const failures = Number(env.ABUSE_KV ? await env.ABUSE_KV.get(`developer-export-fail-hour:${ipKey}`) || 0 : 0);
  if (failures >= 8) return { ok: false, status: 429, error: 'Too many developer authorization attempts.' };
  const suppliedKey = request.headers.get('X-Developer-Key') || '';
  if (!suppliedKey || !(await constantTimeTextEqual(suppliedKey, configuredKey))) {
    if (countFailure) await kvCount(env, `developer-export-fail-hour:${ipKey}`, 3600);
    return { ok: false, status: 403, error: 'Developer authorization failed.' };
  }
  return { ok: true, status: 200, ipKey };
}

async function developerExport(request, env, access, common) {
  const auth = await developerKeyAccepted(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, common);
  const masterKey = fromB64(env.MASTER_WORKBOOK_KEY_B64 || '');
  if (masterKey.length !== 32) return json({ error: 'Protected workbook export key is not configured.' }, 503, common);
  const successCount = await kvCount(env, `developer-export-success-hour:${auth.ipKey}`, 3600);
  if (successCount > 8) return json({ error: 'Developer export rate limit reached.' }, 429, common);
  const envelopeText = await getRepositoryTextFile('secure/master_workbook.enc', env);
  const workbookBytes = await decryptMasterWorkbookEnvelope(envelopeText, env);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `YJMB Trees ${date}.xlsx`;
  return new Response(workbookBytes, {
    status: 200,
    headers: {
      ...common,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function putEncryptedSubmission(id, route, encrypted, env) {
  const path = `.secure_submissions/${route}/${id}.enc.json`;
  await putRepositoryTextFile(path, JSON.stringify(encrypted), env, `Queue protected YJMB submission ${id}`);
  return path;
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
  // v17: ordinary authenticated member changes go straight to the protected
  // automatic queue. The workbook-side updater still fails safely on structural
  // conflicts and moves only those conflicts into review.
  const route = 'auto';
  const protectedValue = {
    id,
    receivedAt: new Date().toISOString(),
    risk: { score: risk.score, reasons: risk.reasons },
    payload,
  };
  const encrypted = await encryptSubmission(protectedValue, env);
  await putEncryptedSubmission(id, route, encrypted, env);
  return { body: { status: route, submissionId: id }, status: 200 };
}

function safeAdminRequest(value, queue, filename) {
  const payload = value?.payload && typeof value.payload === 'object' ? value.payload : {};
  const self = payload.self && typeof payload.self === 'object' ? payload.self : {};
  return {
    id: String(value?.id || filename.replace(/\.enc\.json$/i, '')),
    queue,
    receivedAt: value?.receivedAt || '',
    risk: value?.risk || { score: 0, reasons: [] },
    kind: payload.kind || 'addition',
    personId: payload.personId || null,
    displayName: [self.givenPreferredName, self.familyMaidenName].filter(Boolean).join(' ') || payload.personId || 'Protected update',
    payload,
  };
}

async function readProtectedDirectory(directory, queue, env, limit = 200) {
  const listing = await listRepositoryDirectory(directory, env);
  const files = listing
    .filter((item) => item.type === 'file' && /\.enc\.json$/i.test(item.name))
    .sort((a, b) => String(b.name).localeCompare(String(a.name)))
    .slice(0, limit);
  const results = [];
  for (const item of files) {
    try {
      const text = await getRepositoryTextFile(item.path, env);
      const envelope = JSON.parse(text);
      const value = await decryptSubmissionEnvelope(envelope, env);
      results.push({ ...safeAdminRequest(value, queue, item.name), path: item.path });
    } catch (error) {
      results.push({ id: item.name.replace(/\.enc\.json$/i, ''), queue, path: item.path, error: `Could not decrypt: ${error.message}` });
    }
  }
  return results;
}

async function adminStatus(request, env, common) {
  const auth = await developerKeyAccepted(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, { ...common, 'Cache-Control': 'no-store' });
  return json({ ok: true }, 200, { ...common, 'Cache-Control': 'no-store' });
}

async function adminRequests(request, env, common) {
  const auth = await developerKeyAccepted(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, { ...common, 'Cache-Control': 'no-store' });
  const [review, auto] = await Promise.all([
    readProtectedDirectory('.secure_submissions/review', 'review', env),
    readProtectedDirectory('.secure_submissions/auto', 'auto', env),
  ]);
  return json({ review, auto }, 200, { ...common, 'Cache-Control': 'no-store' });
}

async function adminRequestAction(request, env, common) {
  const auth = await developerKeyAccepted(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, { ...common, 'Cache-Control': 'no-store' });
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').replace(/[^A-Za-z0-9_.-]/g, '');
  const queue = body.queue === 'auto' ? 'auto' : body.queue === 'review' ? 'review' : '';
  const action = String(body.action || '').toLowerCase();
  if (!id || !queue || !['approve', 'deny'].includes(action)) return json({ error: 'Invalid request action.' }, 400, common);
  if (action === 'approve' && queue !== 'review') return json({ error: 'Only review-queue items need approval.' }, 400, common);
  const sourcePath = `.secure_submissions/${queue}/${id}.enc.json`;
  const source = await githubContent(sourcePath, env, { allow404: true });
  if (!source?.sha || !source.content) return json({ error: 'Pending request no longer exists.' }, 404, common);
  if (action === 'deny') {
    await deleteRepositoryFile(sourcePath, source.sha, env, `Deny protected YJMB submission ${id}`);
    return json({ ok: true, status: 'denied', id }, 200, { ...common, 'Cache-Control': 'no-store' });
  }
  const targetPath = `.secure_submissions/auto/${id}.enc.json`;
  const rawText = decoder.decode(fromB64(String(source.content).replace(/\s+/g, '')));
  await putRepositoryTextFile(targetPath, rawText, env, `Approve protected YJMB submission ${id}`);
  await deleteRepositoryFile(sourcePath, source.sha, env, `Move approved YJMB submission ${id} to automatic queue`);
  return json({ ok: true, status: 'approved', id }, 200, { ...common, 'Cache-Control': 'no-store' });
}

async function adminChangelog(request, env, common) {
  const auth = await developerKeyAccepted(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, { ...common, 'Cache-Control': 'no-store' });
  const listing = await listRepositoryDirectory('secure/changelog', env);
  const files = listing
    .filter((item) => item.type === 'file' && /\.enc\.json$/i.test(item.name))
    .sort((a, b) => String(b.name).localeCompare(String(a.name)))
    .slice(0, 150);
  const entries = [];
  for (const item of files) {
    try {
      const text = await getRepositoryTextFile(item.path, env);
      entries.push(await decryptSubmissionEnvelope(JSON.parse(text), env));
    } catch (error) {
      entries.push({ id: item.name.replace(/\.enc\.json$/i, ''), error: `Could not decrypt changelog entry: ${error.message}` });
    }
  }
  return json({ entries }, 200, { ...common, 'Cache-Control': 'no-store' });
}

async function adminAction(request, env, common) {
  const auth = await developerKeyAccepted(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, { ...common, 'Cache-Control': 'no-store' });
  const body = await request.json().catch(() => ({}));
  const payload = body.payload;
  const kind = String(payload?.kind || '');
  const allowed = new Set(['admin-patch', 'admin-add', 'admin-delete', 'admin-reciprocate', 'admin-revert']);
  if (!payload || typeof payload !== 'object' || !allowed.has(kind)) return json({ error: 'Invalid administrator action.' }, 400, common);
  if (JSON.stringify(payload).length > 120000) return json({ error: 'Administrator action is too large.' }, 400, common);
  const id = crypto.randomUUID();
  const protectedValue = {
    id,
    receivedAt: new Date().toISOString(),
    risk: { score: 0, reasons: ['Authorized administrator action.'] },
    payload,
  };
  await putEncryptedSubmission(id, 'auto', await encryptSubmission(protectedValue, env), env);
  return json({ status: 'auto', submissionId: id }, 200, { ...common, 'Cache-Control': 'no-store' });
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
      if (url.pathname === '/developer/export' && request.method === 'POST') {
        const access = await requireAccess(request, env); if (!access) return json({ error: 'Access session expired.' }, 401, common);
        return developerExport(request, env, access, common);
      }
      if (url.pathname.startsWith('/admin/')) {
        const access = await requireAccess(request, env); if (!access) return json({ error: 'Access session expired.' }, 401, common);
        if (url.pathname === '/admin/status' && request.method === 'GET') return adminStatus(request, env, common);
        if (url.pathname === '/admin/requests' && request.method === 'GET') return adminRequests(request, env, common);
        if (url.pathname === '/admin/request-action' && request.method === 'POST') return adminRequestAction(request, env, common);
        if (url.pathname === '/admin/changelog' && request.method === 'GET') return adminChangelog(request, env, common);
        if (url.pathname === '/admin/action' && request.method === 'POST') return adminAction(request, env, common);
      }
      return json({ error: 'Not found.' }, 404, common);
    } catch (error) {
      console.error(error);
      return json({ error: 'The protected service could not complete the request.' }, 500, common);
    }
  },
};
