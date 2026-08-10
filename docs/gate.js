'use strict';

(() => {
  const ACCESS_COOKIE = 'yjmb_family_tree_access_v1';
  const ACCESS_LOCAL = 'yjmbAccessSessionV1';
  const FLOW_KEY = 'yjmbGateFlowV3';
  const stage = Number(document.body.dataset.gateStage || 0);
  const form = document.querySelector('.gate-form');
  const answer = document.querySelector('#gate-answer');
  const status = document.querySelector('.gate-status');
  const content = document.querySelector('.gate-content');
  const transition = document.querySelector('.gate-transition');
  const submit = document.querySelector('.gate-submit');

  const stageFlow = {
    1: { next: 'gate-2.html', transitionColor: '#FFFFFF' },
    2: { next: 'gate-3.html', transitionColor: '#003057' },
    3: { next: 'loading.html', transitionColor: '#FFFFFF' },
  }[stage];

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  function saveAccessToken(token) {
    localStorage.setItem(ACCESS_LOCAL, token);
    document.cookie = `${encodeURIComponent(ACCESS_COOKIE)}=${encodeURIComponent(token)}; Max-Age=2592000; Path=${cookiePath()}; Secure; SameSite=Strict`;
  }

  function readAccessToken() {
    return cookieValue(ACCESS_COOKIE) || localStorage.getItem(ACCESS_LOCAL) || '';
  }

  async function config() {
    const response = await fetch('site_config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('site_config.json could not be loaded.');
    const parsed = await response.json();
    const base = String(parsed.workerApiBase || '').replace(/\/$/, '');
    if (!/^https:\/\//i.test(base) && !/^http:\/\/localhost(?::\d+)?$/i.test(base)) {
      throw new Error('workerApiBase is not configured. Follow GITHUB_SETUP.md and deploy the access Worker.');
    }
    return { ...parsed, workerApiBase: base };
  }

  async function api(base, path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let body = {};
    try { body = await response.json(); } catch { /* no body */ }
    if (!response.ok) {
      const error = new Error(body.error || `Access service returned HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function rememberedSession(cfg) {
    const token = readAccessToken();
    if (!token) return false;
    try {
      await api(cfg.workerApiBase, '/session', { headers: { Authorization: `Bearer ${token}` } });
      localStorage.setItem(ACCESS_LOCAL, token);
      return true;
    } catch {
      localStorage.removeItem(ACCESS_LOCAL);
      document.cookie = `${encodeURIComponent(ACCESS_COOKIE)}=; Max-Age=0; Path=${cookiePath()}; Secure; SameSite=Strict`;
      return false;
    }
  }

  async function accept(cfg, result) {
    submit.disabled = true;
    answer.disabled = true;
    status.textContent = '';
    if (result.flowToken) sessionStorage.setItem(FLOW_KEY, result.flowToken);
    if (result.accessToken) {
      saveAccessToken(result.accessToken);
      sessionStorage.removeItem(FLOW_KEY);
    }
    content.classList.add('is-fading-out');
    await delay(700);
    transition.style.background = stageFlow.transitionColor;
    transition.classList.add('is-visible');
    await delay(750);
    window.location.replace(stageFlow.next);
  }

  async function start() {
    if (!stageFlow || !form) return;
    let cfg;
    try {
      cfg = await config();
      if (stage === 1 && await rememberedSession(cfg)) {
        status.textContent = 'Access remembered on this browser. Opening the tree…';
        await delay(250);
        window.location.replace('loading.html');
        return;
      }
      if (stage > 1 && !sessionStorage.getItem(FLOW_KEY)) {
        window.location.replace('index.html');
        return;
      }
    } catch (error) {
      status.textContent = error.message;
      submit.disabled = true;
      answer.disabled = true;
      return;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = 'Checking…';
      try {
        const result = await api(cfg.workerApiBase, '/auth/stage', {
          method: 'POST',
          body: JSON.stringify({
            stage,
            answer: answer.value,
            flowToken: sessionStorage.getItem(FLOW_KEY) || '',
          }),
        });
        await accept(cfg, result);
      } catch (error) {
        submit.disabled = false;
        status.textContent = error.status === 429 ? 'Too many attempts. Try again later.' : 'Not quite. Try again.';
        form.classList.remove('is-wrong');
        void form.offsetWidth;
        form.classList.add('is-wrong');
        answer.select();
      }
    });
    requestAnimationFrame(() => answer.focus());
  }

  start();
})();
