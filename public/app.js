'use strict';
/* Companion client — no build step, plain ES2017. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CONV_ID_KEY = 'companion_active_conv';
const SCROLL_KEY = 'companion_scroll';

const state = {
  config: null,
  options: null,
  models: null,
  conv: null,
  busy: false,
  history: [],
  dirtyPersona: false,
  showAll: false,
  lastRouting: null,
  pendingMessages: [], // Queue for messages awaiting server confirmation
};

const CONFIG_KEYS = ['baseUrl', 'apiKey', 'model', 'maxInputTokens', 'name'];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const e = (data && data.error) || { kind: 'http_' + res.status, message: 'Request failed (' + res.status + ')' };
    throw e;
  }
  return data;
}

/* ---------------- mobile sidebar toggles ---------------- */

function toggleControls(open) {
  const next = (open === undefined) ? !document.body.classList.contains('ctl-open') : open;
  document.body.classList.toggle('ctl-open', next);
  $('scrim').hidden = !next;
  const b = $('toggle-controls');
  if (b) { b.setAttribute('aria-pressed', String(next)); b.setAttribute('aria-label', next ? 'Close settings panel' : 'Open settings panel'); }
  if (next) { closeRail(false); $('controls').scrollTop = 0; }
  if (next) { try { $('controls').focus({ preventScroll: true }); } catch (e) {} }
}

function toggleRail(open) {
  const next = (open === undefined) ? !document.body.classList.contains('rail-open') : open;
  document.body.classList.toggle('rail-open', next);
  $('scrim').hidden = !next;
  const b = $('toggle-rail');
  if (b) { b.setAttribute('aria-pressed', String(next)); b.setAttribute('aria-label', next ? 'Close conversation history' : 'Open conversation history'); }
  if (next) { closeControls(false); $('history').scrollTop = 0; }
}

function closeControls(open) { if (open === false || open === undefined) toggleControls(false); }
function closeRail(open) { if (open === false || open === undefined) toggleRail(false); }

function syncToggles() {
  const ctl = $('toggle-controls');
  if (ctl) ctl.setAttribute('aria-pressed', String(document.body.classList.contains('ctl-open')));
  const rail = $('toggle-rail');
  if (rail) rail.setAttribute('aria-pressed', String(document.body.classList.contains('rail-open')));
}

/* ---------------- viewport helpers (mobile keyboard + dropdowns) ---------------- */

function keyboardOffset() {
  // On mobile browsers the layout viewport does not shrink when the
  // on-screen keyboard opens; the visual viewport reports the real
  // offset instead. Fall back to 0 on desktop.
  const vv = window.visualViewport;
  if (vv && window.innerWidth < 900) return Math.max(0, window.innerHeight - vv.height);
  return 0;
}

function liftComposerForKeyboard() {
  const composer = $('composer');
  if (!composer) return;
  const offset = keyboardOffset();
  if (offset > 0) {
    composer.style.marginBottom = -offset + 'px';
    composer.style.transition = 'margin-bottom 0.15s ease';
    // Scroll the active input into view above the keyboard.
    const input = document.activeElement;
    if (input && (input.id === 'input' || input.tagName === 'SELECT' || input.tagName === 'TEXTAREA')) {
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  } else {
    composer.style.marginBottom = '';
  }
}

// Native <select> dropdowns are rendered by the OS. On small screens the
// option list is often clipped by the viewport bottom. When the control
// sits low, promote it to a list box so every option is reachable.
function fitSelectDropdown(select) {
  if (!select || window.innerWidth >= 900) return;
  const rect = select.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 240 && select.options.length > 4) {
    select.setAttribute('size', String(Math.min(10, select.options.length)));
    select.classList.add('select-list');
  } else {
    select.removeAttribute('size');
    select.classList.remove('select-list');
  }
}

function fitAllSelects() {
  document.querySelectorAll('select').forEach(fitSelectDropdown);
}

/* ---------------- boot ---------------- */

/* Get conversation ID from URL hash, localStorage, or fallback */
function getActiveConvId() {
  // Priority 1: URL hash (#convId)
  const hash = window.location.hash;
  if (hash && hash.startsWith('#conv=')) {
    return hash.slice(6);
  }
  // Priority 2: localStorage
  try {
    const stored = localStorage.getItem(CONV_ID_KEY);
    if (stored) return stored;
  } catch (e) { /* localStorage may be disabled */ }
  // Priority 3: server-suggested (most recent)
  return null;
}

/* Set active conversation ID in URL and localStorage */
function setActiveConvId(id) {
  if (id) {
    window.location.hash = 'conv=' + id;
    try { localStorage.setItem(CONV_ID_KEY, id); } catch (e) {}
  } else {
    window.location.hash = '';
    try { localStorage.removeItem(CONV_ID_KEY); } catch (e) {}
  }
}

/* Save scroll position for current conversation */
function saveScrollPosition() {
  if (!state.conv) return;
  const t = $('thread');
  if (!t) return;
  try {
    const data = JSON.stringify({ top: t.scrollTop, height: t.scrollHeight });
    localStorage.setItem(SCROLL_KEY + '_' + state.conv.id, data);
  } catch (e) {}
}

/* Restore scroll position for current conversation */
function restoreScrollPosition() {
  if (!state.conv) return;
  try {
    const data = localStorage.getItem(SCROLL_KEY + '_' + state.conv.id);
    if (data) {
      const { top, height } = JSON.parse(data);
      const t = $('thread');
      if (t && Math.abs(t.scrollHeight - height) < 50) {
        t.scrollTop = top;
        return;
      }
    }
  } catch (e) {}
  // Default: scroll to bottom on first load
  scrollBottom();
}

async function boot() {
  try {
    const [config, options, models] = await Promise.all([api('/api/config'), api('/api/options'), api('/api/models')]);
    state.config = config;
    state.options = options;
    state.models = models;
    buildControls();
    fillSettingsForm();
    updateModelBadge();
    await loadHistory();
    // Use URL hash or localStorage to restore the exact conversation
    const convId = getActiveConvId() || config.autoOpenId;
    await openConversation(convId);
  } catch (e) {
    showError(e);
  }

  // Wire up mobile sidebar toggles and viewport behaviour.
  const ctlBtn = $('toggle-controls');
  const railBtn = $('toggle-rail');
  if (ctlBtn) ctlBtn.addEventListener('click', () => toggleControls());
  if (railBtn) railBtn.addEventListener('click', () => toggleRail());
  if ($('scrim')) $('scrim').addEventListener('click', () => { toggleControls(false); toggleRail(false); });
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#controls') || ev.target.closest('#rail') || ev.target.closest('.toggle-btn')) return;
    if (document.body.classList.contains('ctl-open') || document.body.classList.contains('rail-open')) {
      toggleControls(false);
      toggleRail(false);
    }
  });

  // Close sidebars on ESC.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      const closed = !document.body.classList.contains('ctl-open') && !document.body.classList.contains('rail-open');
      toggleControls(false);
      toggleRail(false);
      if (closed) {
        // Nothing open: dismiss the settings modal if it is up.
        if (!$('settings-modal').hidden) $('settings-modal').hidden = true;
      }
    }
  });

  // Keep the composer above the mobile keyboard and the active control in view.
  window.addEventListener('resize', () => { syncToggles(); fitAllSelects(); });
  window.addEventListener('orientationchange', () => setTimeout(fitAllSelects, 300));
  const vv = window.visualViewport;
  if (vv) vv.addEventListener('resize', liftComposerForKeyboard);
  fitAllSelects();
}

/* ---------------- controls ---------------- */

const LABELS = {
  models: {
    default: 'Default (auto:default)',
  },
  personalities: {
    playful: 'Playful', sweet: 'Sweet and affectionate', romantic: 'Romantic', flirty: 'Flirty',
    sarcastic: 'Sarcastic', confident: 'Confident', dominant: 'Dominant', submissive: 'Submissive',
    naughty: 'Naughty', horny: 'Horny and flirtatious', bold: 'Extremely bold', adventurous: 'Adventurous',
    teasing: 'Teasing', sensual: 'Sensual', dirty: 'Dirty-minded humor', wild: 'Wild and unpredictable',
    threesome: 'Threesome fantasy mood', exhibitionist: 'Exhibitionist fantasy mood', passionate: 'Passionate',
    witty: 'Witty and provocative', shybold: 'Shy but secretly bold', assertive: 'Assertive and commanding',
    mischievous: 'Mischievous', custom: 'Custom personality'
  },
  secondaryTraits: {
    '': '(None)',
    playful: 'Playful', sweet: 'Sweet and affectionate', romantic: 'Romantic', flirty: 'Flirty',
    sarcastic: 'Sarcastic', confident: 'Confident', dominant: 'Dominant', submissive: 'Submissive',
    naughty: 'Naughty', horny: 'Horny and flirtatious', bold: 'Extremely bold', adventurous: 'Adventurous',
    teasing: 'Teasing', sensual: 'Sensual', dirty: 'Dirty-minded humor', wild: 'Wild and unpredictable',
    threesome: 'Threesome fantasy mood', exhibitionist: 'Exhibitionist fantasy mood', passionate: 'Passionate',
    witty: 'Witty and provocative', shybold: 'Shy but secretly bold', assertive: 'Assertive and commanding',
    mischievous: 'Mischievous'
  },
  modes: {
    everyday: 'Everyday', flirtation: 'Flirtation', romance: 'Romance',
    adult: 'Adult', roleplay: 'Roleplay', open: 'Open',
  },
  lengths: { short: 'Short Texts', medium: 'Natural Replies', detailed: 'Detailed' },
  initiatives: { reactive: 'Reactive', balanced: 'Balanced', proactive: 'Proactive' },
  styles: { clean: 'Clean', edgy: 'Edgy', profane: 'Profane', direct: 'Very Direct' },
  flirting: { subtle: 'Subtle', playful: 'Playful', bold: 'Bold', intense: 'Intense' },
  consistency: { flexible: 'Flexible', strong: 'Strong' },
  roleplay: { dialogue: 'Dialogue-Focused', descriptive: 'Descriptive' },
  creativities: { grounded: 'Grounded', spontaneous: 'Spontaneous' },
  cultures: { western: 'Western (Default)', indian: 'Indian' },
};

function buildControls() {
  // Model select (from sidebar)
  const modelSelect = $('c-model');
  if (state.models && state.models.filtered) {
    modelSelect.innerHTML = '';
    const currentModel = state.config.model || 'auto:default';
    const available = state.models.filtered.filter(m => m.id !== currentModel);
    if (state.config.model) {
      const opt = document.createElement('option');
      opt.value = state.config.model;
      opt.textContent = state.config.model + ' (current)';
      modelSelect.appendChild(opt);
    }
    for (const m of available) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      if (m.note) opt.title = m.note;
      modelSelect.appendChild(opt);
    }
    modelSelect.onchange = (e) => applyPersonaChange('model', e.target.value);
  }

  // Age select (18-70)
  const ageSelect = $('c-age');
  ageSelect.innerHTML = '';
  for (let i = 18; i <= 70; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    ageSelect.appendChild(opt);
  }
  ageSelect.onchange = (e) => applyPersonaChange('age', Number(e.target.value));

  // Culture select
  const cultureSelect = $('c-culture');
  cultureSelect.innerHTML = '';
  for (const id of (state.options.cultures || ['western', 'indian'])) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.cultures[id] || id;
    cultureSelect.appendChild(opt);
  }
  cultureSelect.onchange = (e) => applyPersonaChange('culture', e.target.value);

  // Personality select
  const persSelect = $('c-personality');
  persSelect.innerHTML = '';
  for (const id of (state.options.personalities || [])) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.personalities[id] || id;
    persSelect.appendChild(opt);
  }
  persSelect.onchange = (e) => {
    const val = e.target.value;
    $('custom-personality-group').style.display = val === 'custom' ? 'block' : 'none';
    applyPersonaChange('personality', val);
  };

  // Model refresh button
  const btnModelRefresh = $('btn-model-refresh');
  if (btnModelRefresh) {
    btnModelRefresh.onclick = () => {
      toast('Refreshing model catalog...');
      fetch('/api/models/refresh', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.err) toast('Failed to refresh models: ' + data.err);
          else {
            state.models = data;
            fillSettingsForm();
            toast('Model catalog refreshed.');
          }
        })
        .catch(e => toast('Refresh failed: ' + String(e)));
    };
  }

  // Secondary trait select
  const secSelect = $('c-secondaryTrait');
  secSelect.innerHTML = '';
  for (const id in LABELS.secondaryTraits) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.secondaryTraits[id];
    secSelect.appendChild(opt);
  }
  secSelect.onchange = (e) => applyPersonaChange('secondaryTrait', e.target.value);

  // Custom textarea
  const customArea = $('c-customPersonality');
  customArea.onchange = (e) => applyPersonaChange('customPersonality', e.target.value);

  // Mode chips
  const modeEl = $('c-mode');
  modeEl.innerHTML = '';
  for (const id of (state.options.modes || [])) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.key = 'mode';
    b.dataset.value = id;
    b.textContent = LABELS.modes[id] || id;
    b.addEventListener('click', () => applyPersonaChange('mode', id));
    modeEl.appendChild(b);
  }

  // Length select
  const lenSelect = $('c-length');
  lenSelect.innerHTML = '';
  for (const id of (state.options.lengths || [])) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.lengths[id] || id;
    lenSelect.appendChild(opt);
  }
  lenSelect.onchange = (e) => applyPersonaChange('length', e.target.value);

  // Initiative select
  const initSelect = $('c-initiative');
  initSelect.innerHTML = '';
  for (const id of (state.options.initiatives || [])) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.initiatives[id] || id;
    initSelect.appendChild(opt);
  }
  initSelect.onchange = (e) => applyPersonaChange('initiative', e.target.value);

  // Style select
  const styleSelect = $('c-style');
  styleSelect.innerHTML = '';
  for (const id of (state.options.styles || [])) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.styles[id] || id;
    styleSelect.appendChild(opt);
  }
  styleSelect.onchange = (e) => applyPersonaChange('style', e.target.value);

  // Flirting select
  const flirtSelect = $('c-flirting');
  flirtSelect.innerHTML = '';
  for (const id of (state.options.flirting || ['subtle', 'playful', 'bold', 'intense'])) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.flirting[id] || id;
    flirtSelect.appendChild(opt);
  }
  flirtSelect.onchange = (e) => applyPersonaChange('flirting', e.target.value);

  // Consistency select
  const consSelect = $('c-consistency');
  consSelect.innerHTML = '';
  for (const id of (state.options.consistency || ['flexible', 'strong'])) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.consistency[id] || id;
    consSelect.appendChild(opt);
  }
  consSelect.onchange = (e) => applyPersonaChange('consistency', e.target.value);

  // Roleplay narration select
  const rpSelect = $('c-roleplay');
  rpSelect.innerHTML = '';
  for (const id of (state.options.roleplay || ['dialogue', 'descriptive'])) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = LABELS.roleplay[id] || id;
    rpSelect.appendChild(opt);
  }
  rpSelect.onchange = (e) => applyPersonaChange('roleplay', e.target.value);

  // Creativity chips
  const creatEl = $('c-creativity');
  creatEl.innerHTML = '';
  for (const id of (state.options.creativities || [])) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.key = 'creativity';
    b.dataset.value = id;
    b.textContent = LABELS.creativities[id] || id;
    b.addEventListener('click', () => applyPersonaChange('creativity', id));
    creatEl.appendChild(b);
  }

  paintControls();
}

function paintControls() {
  const p = state.conv ? state.conv.persona : state.config.persona;
  if (!p) return;

  fitAllSelects();

  // Model select
  const modelSelect = $('c-model');
  if (state.config.model && modelSelect) {
    modelSelect.value = state.config.model;
  }

  // Age select
  $('c-age').value = p.age || 25;
  $('c-culture').value = p.culture || 'western';
  $('c-personality').value = p.personality || 'playful';
  $('c-secondaryTrait').value = p.secondaryTrait || '';
  $('c-length').value = p.length || 'medium';
  $('c-initiative').value = p.initiative || 'balanced';
  $('c-style').value = p.style || 'edgy';
  $('c-flirting').value = p.flirting || 'playful';
  $('c-consistency').value = p.consistency || 'flexible';
  $('c-roleplay').value = p.roleplay || 'dialogue';
  $('c-customPersonality').value = p.customPersonality || '';
  $('custom-personality-group').style.display = p.personality === 'custom' ? 'block' : 'none';

  document.querySelectorAll('.chip[data-key]').forEach(ch => {
    ch.classList.toggle('on', ch.dataset.value === String(p[ch.dataset.key]));
  });

  const note = $('age-note');
  note.textContent = `Age ${p.age} selected (18–70) — applies to this conversation.`;
}

function applyPersonaChange(key, value) {
  if (!state.conv) return;
  if (key === 'age' || key === 'personality' || key === 'mode' || key === 'model' || key === 'culture') {
    state.dirtyPersona = true;
    $('btn-opening').classList.add('glow');
  }

  if (key === 'model') {
    // Save model to global config so it persists and is used in API requests
    api('/api/config', { method: 'POST', body: { model: value } })
      .then(r => {
        state.config = r.config;
        // Also update conversation persona
        return api('/api/conversations/' + state.conv.id, { method: 'PATCH', body: { persona: { model: value } } });
      })
      .then(r => {
        state.conv = r.conv;
        paintControls();
        updateTopbar();
        toast('Model set to ' + value);
        // Refresh model list in sidebar when model changes
        if (state.models) {
          fetch('/api/models/refresh', { method: 'POST' })
            .then(r => r.json())
            .then(data => {
              if (!data.err) {
                state.models = data;
                fillSettingsForm();
              }
            })
            .catch(e => console.error('[app] model refresh failed:', e));
        }
      })
      .catch(showError);
    return;
  }

  const patch = { [key]: value };
  api('/api/conversations/' + state.conv.id, { method: 'PATCH', body: { persona: patch } })
    .then(r => {
      state.conv = r.conv;
      paintControls();
      updateTopbar();
      if (key === 'age') toast('Age set to ' + value + ' — she talks differently now.');
      if (key === 'culture') toast('Culture set to ' + (LABELS.cultures[value] || value) + ' — new characters will use this culture.');
    })
    .catch(showError);
}

/* ---------------- history ---------------- */

async function loadHistory() {
  const r = await api('/api/conversations');
  state.history = r.items || [];
  renderHistory();
}

function renderHistory() {
  const nav = $('history');
  nav.innerHTML = '';
  if (!state.history.length) {
    const d = document.createElement('div');
    d.className = 'hist-empty';
    d.textContent = 'No conversations yet.';
    nav.appendChild(d);
    return;
  }
  for (const h of state.history) {
    const btn = document.createElement('button');
    btn.className = 'hist-item' + (h.id === (state.conv && state.conv.id) ? ' active' : '');
    btn.dataset.id = h.id;

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = h.title || 'Untitled';
    btn.appendChild(t);

    const del = document.createElement('button');
    del.className = 'del';
    del.title = 'Delete conversation';
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/></svg>';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteConversation(h.id);
    });
    btn.appendChild(del);

    btn.addEventListener('click', () => openConversation(h.id));
    nav.appendChild(btn);
  }
}

async function newConversation() {
  const r = await api('/api/conversations', { body: {} });
  state.conv = r.conv;
  state.dirtyPersona = false;
  $('btn-opening').classList.remove('glow');
  renderThread();
  paintControls();
  updateTopbar();
  await loadHistory();
  // Set as active conversation
  setActiveConvId(r.conv.id);
  try {
    await greeting(r.conv.id);
  } catch (e) { showError(e); }
}

async function openConversation(id) {
  if (id) {
    try {
      const r = await api('/api/conversations/' + id);
      state.conv = r.conv;
      state.dirtyPersona = false;
      $('btn-opening').classList.remove('glow');
      renderThread();
      paintControls();
      updateTopbar();
      renderHistory();
      // Update URL and localStorage
      setActiveConvId(id);
      // Restore scroll position after a short delay to let layout settle
      setTimeout(restoreScrollPosition, 50);
      return;
    } catch (e) {
      // Conversation not found - recover by creating a new one
      // rather than permanently blocking the input
      if (e.kind === 'no_conv') {
        console.warn('[app] Conversation not found, creating new one:', id);
        // Clear stale localStorage/URL references
        setActiveConvId(null);
        await newConversation();
        return;
      }
      throw e;
    }
  }
  await newConversation();
}

async function deleteConversation(id) {
  if (state.conv && state.conv.id === id) { state.conv = null; renderThread(); }
  await api('/api/conversations/' + id, { method: 'DELETE' });
  await loadHistory();
  if (!state.conv) await newConversation();
  // Clear stored ID if it was the deleted conversation
  try {
    const stored = localStorage.getItem(CONV_ID_KEY);
    if (stored === id) localStorage.removeItem(CONV_ID_KEY);
  } catch (e) {}
}

/* ---------------- messages ---------------- */

function renderThread() {
  const t = $('thread');
  t.innerHTML = '';
  const c = state.conv;
  if (!c || !c.messages.length) {
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.innerHTML = '<b>Say hi.</b>Her first message is on its way — she opens conversations her way, so just roll with it.';
    t.appendChild(d);
    return;
  }
  for (const m of c.messages) appendMessage(m.role, m.content, true);
  scrollBottom();
}

function appendMessage(role, text, skipScroll) {
  const t = $('thread');
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  d.textContent = text;
  t.appendChild(d);
  if (!skipScroll) scrollBottom();
}

function typing(on) {
  const t = $('thread');
  $('typing') && $('typing').remove();
  if (!on) return;
  const d = document.createElement('div');
  d.className = 'typing';
  d.id = 'typing';
  d.innerHTML = '<i></i><i></i><i></i>';
  t.appendChild(d);
  scrollBottom();
}

function scrollBottom() { const t = $('thread'); t.scrollTop = t.scrollHeight; }

/* Save scroll position on scroll (throttled) */
let scrollTimer = null;
$('thread')?.addEventListener('scroll', () => {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(saveScrollPosition, 150);
});

/* Handle browser back/forward and manual hash changes */
window.addEventListener('hashchange', async () => {
  const convId = getActiveConvId();
  if (convId && state.conv && state.conv.id !== convId) {
    await openConversation(convId);
  }
});

async function greeting(convId) {
  if (state.busy) return;
  state.busy = true;
  setComposer(false);
  typing(true);
  try {
    const r = await api('/api/opening', { body: { convId } });
    state.conv.messages = state.conv.messages || [];
    state.conv.messages.push({ role: 'assistant', content: r.reply, at: Date.now() });
    const e = $('empty-state'); e && e.remove();
    appendMessage('assistant', r.reply);
    renderMeta(r.meta);
    updateTopbar();
    await loadHistory();
  } catch (e) {
    showError(e);
  } finally {
    typing(false);
    state.busy = false;
    setComposer(true);
  }
}

/* Message ID generator for idempotency */
let messageIdCounter = 0;
function generateMessageId() {
  return 'm_' + Date.now().toString(36) + '_' + (messageIdCounter++);
}

async function send() {
  const input = $('input');
  const text = input.value.trim();
  if (!text || state.busy || !state.conv) return;
  // Prevent duplicate sends for the same message
  if (state.busy) return;

  // Create a pending message record
  const msgId = generateMessageId();
  const pendingMsg = {
    id: msgId,
    role: 'user',
    content: text,
    at: Date.now(),
    status: 'pending'
  };

  input.value = '';
  input.style.height = 'auto';
  appendMessage('user', text);
  state.busy = true;
  setComposer(false);
  typing(true);

  // Add to pending queue
  state.pendingMessages.push(pendingMsg);

  try {
    const r = await api('/api/send', { body: { convId: state.conv.id, text, config: { model: state.config.model }, messageId: msgId } });
    // Remove from pending queue on success
    state.pendingMessages = state.pendingMessages.filter(m => m.id !== msgId);

    state.conv.messages = state.conv.messages || [];
    state.conv.messages.push({ role: 'user', content: text, at: Date.now() });
    state.conv.messages.push({ role: 'assistant', content: r.reply, at: Date.now() });
    $('typing') && $('typing').remove();
    appendMessage('assistant', r.reply);
    renderMeta(r.meta);
    if (r.meta && r.meta.refused) {
      // The model declined: show a hint and offer a fresh scene
      toast('The model declined to answer that. Try rephrasing, or start a fresh scene.');
    }
    updateTopbar();
    await loadHistory();
  } catch (e) {
    // If the conversation is missing, recover by creating a new one
    // rather than permanently blocking the input
    if (e.kind === 'no_conv') {
      console.warn('[app] Conversation missing during send, creating new one:', e);
      showError(e);
      await recoverFromMissingConv();
      return;
    }
    showError(e);
    // Mark message as failed in pending queue
    const pending = state.pendingMessages.find(m => m.id === msgId);
    if (pending) {
      pending.status = 'failed';
      toast('Message failed to send. You can retry or refresh.');
    }
  } finally {
    typing(false);
    state.busy = false;
    setComposer(true);
    input.focus();
  }
}

/* Recover from a missing conversation by creating a new one and
   preserving the user's typed text. Does not overwrite or delete
   existing conversations. */
async function recoverFromMissingConv() {
  const input = $('input');
  const text = input.value.trim();
  state.pendingMessages = [];
  await newConversation();
  if (text) input.value = text;
}

/* Retry failed pending messages */
async function retryPendingMessages() {
  const failed = state.pendingMessages.filter(m => m.status === 'failed');
  if (!failed.length) return;

  toast('Retrying ' + failed.length + ' failed message(s)...');
  for (const msg of failed) {
    msg.status = 'retrying';
    const input = $('input');
    input.value = msg.content;
    await send();
  }
}

function setComposer(enabled) {
  $('btn-send').disabled = !enabled;
  $('btn-opening').disabled = !enabled;
  $('btn-compress').disabled = !enabled;
}

/* ---------------- topbar / misc ---------------- */

function updateTopbar() {
  updateModelBadge();
  if (!state.conv) return;
  $('persona-name').textContent = state.config.name;
  const p = state.conv.persona;
  const pers = (LABELS.personalities[p.personality] || p.personality).toLowerCase();
  const mode = (LABELS.modes[p.mode] || p.mode).toLowerCase();
  const culture = p.culture === 'indian' ? 'Indian' : 'Western';
  $('persona-sub').textContent = `${p.age} · ${pers} · ${mode} · ${culture}`;
  $('avatar').textContent = state.config.name.charAt(0).toUpperCase();
}

function showError(e) {
  const bar = $('error-bar');
  bar.querySelector('.k').textContent = e.kind || 'error';
  bar.querySelector('.msg').textContent = e.message || String(e);
  bar.hidden = false;
}

$('err-dismiss').addEventListener('click', () => { $('error-bar').hidden = true; });

function toast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1c1418;border:1px solid rgba(224,86,122,.4);color:#ffdbe6;padding:9px 16px;border-radius:10px;font-size:12.5px;z-index:60;box-shadow:0 12px 40px rgba(0,0,0,.5)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3400);
}

/* ---------------- settings modal ---------------- */

/* ---------------- models ---------------- */

function modelRows() {
  const mp = state.models || { filtered: [], all: [], err: 'not loaded' };
  if (state.showAll) {
    return mp.all.map(m => ({
      id: m.id,
      label: m.name + (m.available ? '' : ' — unavailable' + (m.reason ? ' (' + m.reason + ')' : '')),
      badge: m.available ? (m.status || 'unknown status') : 'unavailable'
    }));
  }
  return mp.filtered.map(m => ({ id: m.id, label: m.label, badge: m.note }));
}

function fillSettingsForm() {
  const c = state.config;
  const s = state.models || {};

  // Update sidebar model select
  const sidebarSelect = $('c-model');
  if (sidebarSelect && s.filtered) {
    const currentModel = c.model || 'auto:default';
    const available = s.filtered.filter(m => m.id !== currentModel);

    // Clear existing options
    while (sidebarSelect.children.length > 0) sidebarSelect.removeChild(sidebarSelect.firstChild);

    if (c.model) {
      const opt = document.createElement('option');
      opt.value = c.model;
      opt.textContent = c.model + ' (current)';
      sidebarSelect.appendChild(opt);
    }

    for (const m of available) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      if (m.note) opt.title = m.note;
      sidebarSelect.appendChild(opt);
    }

    if (sidebarSelect.querySelector('option[value="' + CSS.escape(currentModel) + '"]')) {
      sidebarSelect.value = currentModel;
    } else if (sidebarSelect.children.length > 0) {
      sidebarSelect.value = sidebarSelect.children[0].value;
    }
  }

  $('s-baseUrl').value = c.baseUrl || '';
  $('s-apiKey').value = '';
  $('s-apiKey').placeholder = c.hasKey ? `current: …${c.keyPreview} (from ${c.keySource}) — leave blank to keep` : 'no key found — paste one here';
  $('s-maxInputTokens').value = c.maxInputTokens || 20000;
  $('s-name').value = c.name || '';

  // Bind host and LAN settings
  $('s-bindHost').value = c.bindHost || '127.0.0.1';
  $('s-allowLAN').checked = c.allowLAN !== false;

  const active = c.model || 'auto:default';
  const rows = modelRows();
  const sel = $('s-model');
  sel.innerHTML = '';
  if (!state.showAll && !rows.some(r => r.id === active)) {
    const o = document.createElement('option');
    o.value = active;
    o.textContent = active + ' — outside the filtered list';
    o.dataset.badge = 'Not verified against the catalog. Enable "Show all" to troubleshoot.';
    sel.appendChild(o);
  }
  for (const r of rows) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.label;
    o.dataset.badge = r.badge || '';
    sel.appendChild(o);
  }
  sel.value = sel.querySelector('option[value="' + CSS.escape(active) + '"]') ? active : (rows[0] ? rows[0].id : active);
  $('s-showall').checked = state.showAll;
  paintModelNote();
  $('s-policynote').textContent = (state.models && state.models.policyNote) || '';

  const mp = state.models || {};
  const excludedCount = (mp.excluded || []).reduce((n, g) => n + (g.ids ? g.ids.length : 0), 0);
  $('s-modelnote').title = '';
  sel.onchange = paintModelNote;
  if (mp.err) toast('Model catalog could not be read: ' + mp.err);
  else if (!state.showAll) toast(filteredSummary(mp));
}

function paintModelNote() {
  const sel = $('s-model');
  const opt = sel.selectedOptions[0];
  const mp = state.models || {};
  const head = opt && opt.dataset.badge ? opt.dataset.badge : '';
  const counts = mp.total
    ? `${(mp.filtered || []).length} of ${mp.total} catalog models passed the chat-capability filter.`
    : 'No catalog data.';
  $('s-modelnote').textContent = [head, counts].filter(Boolean).join(' — ');
}

function filteredSummary(mp) {
  const f = (mp.filtered || []).length;
  return `Models: ${f} chat-capable of ${mp.total} catalogued.`;
}

function updateModelBadge(routing) {
  const el = $('model-line');
  if (!el) return;
  const id = state.config.model || 'auto:default';
  const info = ((state.models || {}).filtered || []).find(m => m.id === id);
  const r = routing || state.lastRouting;
  el.textContent = id + (info && info.note ? ' · ' + info.note : '') + (r ? ' · ' + r : '');
  el.className = 'model-line' + (r === 'substituted' || r === 'unreported' ? ' bad' : '');
  el.title = ((state.models || {}).policyNote) || '';
}

const ROUTING_TEXT = {
  exact: 'selected model answered',
  opaque: 'router alias — backend not reported by the proxy',
  substituted: 'different model answered',
  unreported: 'no model id reported'
};

function renderMeta(meta) {
  if (!meta) return;
  state.lastRouting = meta.routing;
  const bits = [meta.requestedModel || state.config.model];
  if (meta.servedModel && meta.servedModel !== meta.requestedModel) bits.push('served: ' + meta.servedModel);
  if (meta.routing) bits.push(ROUTING_TEXT[meta.routing] || meta.routing);
  $('hint-meta').textContent = bits.join(' · ');
  if (meta.routing === 'substituted') toast(`The proxy answered with "${meta.servedModel}" instead of the model you selected ("${meta.requestedModel}"). Nothing was silently substituted on your end — this is the proxy re-routing.`);
  if (meta.routing === 'unreported') toast('The proxy reported no model id, so the answering model cannot be verified.');
  if (meta.routing === 'opaque') toast('"meta" is a router slot: the proxy echoes the alias back, so the real backend is unknowable from the response.');
  updateModelBadge(meta.routing);
}

function openSettingsModal() {
  fillSettingsForm();
  // A modal and a slide-out sidebar fight for the same screen on mobile.
  toggleControls(false);
  toggleRail(false);
  $('settings-modal').hidden = false;
  fitAllSelects();
}
function closeSettingsModal() {
  $('settings-modal').hidden = true;
  liftComposerForKeyboard();
}

$('btn-settings').addEventListener('click', () => openSettingsModal());
$('s-showall').addEventListener('change', (e) => { state.showAll = e.target.checked; fillSettingsForm(); });
$('btn-close-settings').addEventListener('click', () => closeSettingsModal());
$('settings-modal').addEventListener('click', (ev) => { if (ev.target === $('settings-modal')) closeSettingsModal(); });
// ESC is handled globally above; this guards the modal's own focus traps.
$('settings-modal').addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { closeSettingsModal(); return; }
  if (ev.key !== 'Tab') return;
  const focusables = $('settings-modal').querySelectorAll('input, select, textarea, button, [href]');
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
});
// On mobile the on-screen keyboard pushes the modal card up and out of
// view. When an input inside the modal gains focus, scroll the card so the
// active field (and the Save button) stay reachable.
$('settings-modal').addEventListener('focus', (ev) => {
  if (window.innerWidth >= 900) return;
  const card = $('settings-modal').querySelector('.modal-card');
  if (!card) return;
  requestAnimationFrame(() => {
    const r = ev.target.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    if (r.bottom > cr.bottom - 4) {
      card.scrollTop += (r.bottom - cr.bottom) + 16;
    }
  });
}, true);

$('btn-test').addEventListener('click', async () => {
  const res = $('s-result');
  res.hidden = false;
  res.dataset.ok = '';
  res.textContent = 'testing…';
  try {
    const patch = {};
    if ($('s-baseUrl').value.trim()) patch.baseUrl = $('s-baseUrl').value.trim();
    if ($('s-apiKey').value.trim()) patch.apiKey = $('s-apiKey').value.trim();
    if (Object.keys(patch).length) {
      const saved = await api('/api/config', { body: patch });
      state.config = { ...state.config, ...patch, ...saved.config };
    }
    const id = $('s-model').value.trim();
    const r = await api('/api/test', { body: { model: id } });
    res.dataset.ok = r.ok ? '1' : '0';
    res.textContent = [
      'model: ' + r.model,
      r.ok ? 'routing: ' + r.routing + ' (' + (ROUTING_TEXT[r.routing] || '') + ')' : 'FAILED (' + r.kind + '): ' + r.error,
      'served id: ' + (r.served || '(none reported)'),
      'catalog verdict: ' + JSON.stringify(r.catalog),
      'key: ' + r.keySource + ' | catalogued models: ' + r.knownCount,
      r.ok ? 'probe reply: ' + r.reply : ''
    ].filter(Boolean).join('\n');
    if (r.ok) renderMeta({ requestedModel: r.model, servedModel: r.served, routing: r.routing });
  } catch (e) {
    res.dataset.ok = '0';
    res.textContent = e.message || String(e);
  }
});

$('btn-save-settings').addEventListener('click', async () => {
  const body = {
    baseUrl: $('s-baseUrl').value.trim() || undefined,
    model: $('s-model').value.trim() || undefined,
    maxInputTokens: Number($('s-maxInputTokens').value) || undefined,
    name: $('s-name').value.trim() || undefined,
  };
  const keyVal = $('s-apiKey').value.trim();
  if (keyVal) body.apiKey = keyVal; else body.apiKey = null;
  // Pass through bind host and LAN settings
  body.bindHost = $('s-bindHost').value.trim() || undefined;
  body.allowLAN = $('s-allowLAN').checked;
  try {
    const r = await api('/api/config', { body });
    state.config = r.config;
    fillSettingsForm();
    updateTopbar();
    closeSettingsModal();
    toast('Settings saved.');
  } catch (e) { showError(e); }
});

/* ---------------- actions ---------------- */

$('btn-new').addEventListener('click', async () => { try { await newConversation(); } catch (e) { showError(e); } });

$('btn-regen').addEventListener('click', async () => {
  if (!state.conv) return;
  if (!confirm('Generate a completely new random character with the current culture setting? This will create a new conversation.')) return;
  try {
    const r = await api('/api/conversations', { body: { persona: { culture: state.conv.persona.culture || 'western' } } });
    state.conv = r.conv;
    state.dirtyPersona = false;
    $('btn-opening').classList.remove('glow');
    renderThread();
    paintControls();
    updateTopbar();
    await loadHistory();
    try {
      await greeting(r.conv.id);
    } catch (e) { showError(e); }
  } catch (e) { showError(e); }
});

$('btn-send').addEventListener('click', send);
$('input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
});
$('input').addEventListener('input', (ev) => {
  ev.target.style.height = 'auto';
  ev.target.style.height = Math.min(ev.target.scrollHeight, 168) + 'px';
});

$('btn-opening').addEventListener('click', async () => {
  if (state.busy || !state.conv) return;
  if (state.dirtyPersona && !confirm('Your persona changed. Keep current messages and restart the scene with the new persona?')) return;
  state.dirtyPersona = false;
  $('btn-opening').classList.remove('glow');
  setComposer(false);
  typing(true);
  try {
    // Reset scene state (character identity preserved) then open fresh
    await api('/api/conversations/' + state.conv.id + '/reset-scene', { method: 'POST', body: { keepLast: 0 } });
    const r = await api('/api/opening', { body: { convId: state.conv.id } });
    state.conv.messages = state.conv.messages || [];
    state.conv.messages.push({ role: 'assistant', content: r.reply, at: Date.now() });
    renderThread();
    appendMessage('assistant', r.reply);
    await loadHistory();
  } catch (e) { showError(e); }
  finally { typing(false); state.busy = false; setComposer(true); }
});

$('btn-compress').addEventListener('click', async () => {
  if (state.busy || !state.conv) return;
  setComposer(false);
  typing(true);
  try {
    const r = await api('/api/compress', { body: { convId: state.conv.id } });
    typing(false);
    toast(`Compact: ${r.dropped || '—'} message(s) folded into memory.`);
  } catch (e) { showError(e); }
  finally { typing(false); state.busy = false; setComposer(true); }
});

/* ---------------- keyboard ---------------- */

document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && ev.key === 'k') { ev.preventDefault(); openSettingsModal(); }
  if (ev.ctrlKey && ev.key === 'n') { ev.preventDefault(); newConversation().catch(showError); }
});

boot();
