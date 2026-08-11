'use strict';

(() => {
  const ACCESS_COOKIE = 'yjmb_family_tree_access_v1';
  const ACCESS_LOCAL = 'yjmbAccessSessionV1';
  const DATA_KEY_SESSION = 'yjmbDataKeyV3';
  const ENCRYPTED_URL = 'data/tree_data.enc';
  let envelopePromise = null;
  let configPromise = null;
  let dataPromise = null;

  class AccessRequiredError extends Error {
    constructor(message = 'Access verification is required.') {
      super(message); this.name = 'AccessRequiredError'; this.code = 'AUTH_REQUIRED';
    }
  }

  function cookiePath() {
    if (location.hostname.toLowerCase().endsWith('.github.io')) {
      const first = location.pathname.split('/').filter(Boolean)[0];
      if (first && !/\.html?$/i.test(first)) return `/${first}/`;
    }
    return '/';
  }
  function cookieValue(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    for (const part of document.cookie.split(';')) {
      const item = part.trim();
      if (item.startsWith(prefix)) return decodeURIComponent(item.slice(prefix.length));
    }
    return '';
  }
  function getAccessToken() { return cookieValue(ACCESS_COOKIE) || localStorage.getItem(ACCESS_LOCAL) || ''; }
  function rememberAccessToken(token) {
    localStorage.setItem(ACCESS_LOCAL, token);
    document.cookie = `${encodeURIComponent(ACCESS_COOKIE)}=${encodeURIComponent(token)}; Max-Age=2592000; Path=${cookiePath()}; Secure; SameSite=Strict`;
  }
  function clearAccess() {
    sessionStorage.removeItem(DATA_KEY_SESSION);
    localStorage.removeItem(ACCESS_LOCAL);
    document.cookie = `${encodeURIComponent(ACCESS_COOKIE)}=; Max-Age=0; Path=${cookiePath()}; Secure; SameSite=Strict`;
    dataPromise = null;
  }
  function bytesToBase64(bytes) {
    let binary = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }
  function base64ToBytes(text) {
    const binary = atob(text); const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  async function config() {
    if (!configPromise) configPromise = fetch('site_config.json', { cache: 'no-store' }).then(async (r) => {
      if (!r.ok) throw new Error('site_config.json could not be loaded.');
      const cfg = await r.json();
      cfg.workerApiBase = String(cfg.workerApiBase || '').replace(/\/$/, '');
      return cfg;
    });
    return configPromise;
  }
  async function envelope() {
    if (!envelopePromise) envelopePromise = fetch(ENCRYPTED_URL, { cache: 'no-store' }).then(async (r) => {
      if (!r.ok) throw new Error(`Encrypted tree bundle returned HTTP ${r.status}.`);
      const parsed = await r.json();
      if (parsed.format !== 'yjmb-tree-encrypted-v3') throw new Error('Unsupported encrypted tree format. Rebuild the site.');
      return parsed;
    });
    return envelopePromise;
  }
  async function apiFetch(path, options = {}) {
    const cfg = await config();
    const token = getAccessToken();
    if (!token) throw new AccessRequiredError();
    const response = await fetch(`${cfg.workerApiBase}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    let body = {};
    try { body = await response.json(); } catch { /* empty */ }
    if (response.status === 401) { clearAccess(); throw new AccessRequiredError(); }
    if (!response.ok) throw new Error(body.error || `Access service returned HTTP ${response.status}.`);
    return body;
  }
  async function sessionDataKey(onProgress = () => {}) {
    const cached = sessionStorage.getItem(DATA_KEY_SESSION);
    if (cached) return base64ToBytes(cached);
    onProgress(22, 'Validating remembered access…');
    const body = await apiFetch('/session/key');
    if (!body.dataKey) throw new Error('Access service did not return a tree key.');
    const raw = base64ToBytes(body.dataKey);
    if (raw.length !== 32) throw new Error('Access service returned an invalid tree key.');
    sessionStorage.setItem(DATA_KEY_SESSION, bytesToBase64(raw));
    return raw;
  }
  async function decryptPayload(rawDataKey, env) {
    const key = await crypto.subtle.importKey('raw', rawDataKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(env.dataIv), tagLength: 128 }, key, base64ToBytes(env.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
  async function unlockFromSession(onProgress = () => {}) {
    if (!window.isSecureContext || !crypto?.subtle) throw new Error('Web Crypto requires HTTPS or http://localhost.');
    onProgress(8, 'Retrieving encrypted tree bundle…');
    const [env, rawDataKey] = await Promise.all([envelope(), sessionDataKey(onProgress)]);
    onProgress(55, 'Decrypting protected tree data…');
    const data = await decryptPayload(rawDataKey, env);
    dataPromise = Promise.resolve(data);
    onProgress(70, 'Encrypted tree unlocked.');
    return data;
  }
  async function loadTreeData() {
    if (dataPromise) return dataPromise;
    if (!getAccessToken()) throw new AccessRequiredError();
    dataPromise = unlockFromSession().catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
  }
  function filenameFromDisposition(value) {
    const match = String(value || '').match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    if (!match) return '';
    try { return decodeURIComponent(match[1].replace(/^"|"$/g, '').trim()); }
    catch { return match[1].replace(/^"|"$/g, '').trim(); }
  }
  async function downloadDeveloperWorkbook(developerKey) {
    const key = String(developerKey || '');
    if (!key) throw new Error('Developer export key is required.');
    const cfg = await config();
    const token = getAccessToken();
    if (!token) throw new AccessRequiredError();
    const response = await fetch(`${cfg.workerApiBase}/developer/export`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Developer-Key': key,
      },
      cache: 'no-store',
    });
    if (response.status === 401) { clearAccess(); throw new AccessRequiredError(); }
    if (!response.ok) {
      let message = `Developer export returned HTTP ${response.status}.`;
      try { const body = await response.json(); if (body?.error) message = body.error; } catch { /* binary/empty */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get('Content-Disposition')) || `YJMB Trees ${new Date().toISOString().slice(0, 10)}.xlsx`;
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    return filename;
  }
  window.YJMBSecureData = {
    AccessRequiredError,
    unlockFromSession,
    loadTreeData,
    clearAccess,
    getAccessToken,
    rememberAccessToken,
    apiFetch,
    downloadDeveloperWorkbook,
  };
})();
