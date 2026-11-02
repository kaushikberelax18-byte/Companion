'use strict';
/* Classification of the FreeLLMAPI model catalog (/v1/models).

The catalog reports capability only: availability, execution status, supported
parameters, context length. It carries no content-policy field, so nothing here
can certify a model as permissive. This module answers a narrower question —
"is this usable as a chat model that will honour an exact model id?" — and
labels the rest honestly.
*/

/* Ids that name a slot in a router rather than a model. Selecting one cannot
pin a backend, so it cannot satisfy "send this id and get this model". */
const ROUTER_IDS = new Set(['auto', 'auto:default', 'fusion', 'free-router', 'kilo-auto']);

/* Models whose documented purpose is to police or classify content. Routing a
companion conversation through one adds an application-side filter on top of
whatever the provider already enforces. */
/* Word-boundary match, but ids like "qwen3guard-gen-8b" have no delimiter
   between the brand and the word, so the brand prefix is matched too. */
const SAFETY = /(?:^|[-_\s/])(?:guard|safeguard|safety|moderation|moderator|censor|filter|blocker|refusal|topic-control)(?:[-_\s/]|$)|content-safety|guardrail|nemoguard|prompt-guard|qwen3guard|nemoguard/i;

/* Documented non-conversational specialties. */
const NON_CHAT = /(?:^|[-_\s/])(?:embed|embedding|embeds|rerank|reranker|ocr|tts|asr|stt|whisper|speech|transcribe|classifier|classification|segmentation|depth|detection|detector|world-model|cosmos)(?:[-_\s/]|$)|robotics/i;

function isRouter(rec) {
  if (ROUTER_IDS.has(String(rec.id))) return true;
  if (!Array.isArray(rec.supported_parameters) || rec.supported_parameters.length === 0) return true;
  return /\brouter\b|auto-routed|panel of models|slot/i.test(String(rec.name || ''));
}

function isSafety(rec) {
  return SAFETY.test(rec.id + ' ' + (rec.name || ''));
}

function isNonChat(rec) {
  return NON_CHAT.test(rec.id + ' ' + (rec.name || ''));
}

function supportsChat(rec) {
  const p = rec.supported_parameters || [];
  const tokenParam = p.includes('max_tokens') || p.includes('max_completion_tokens');
  return tokenParam && p.includes('temperature');
}

/* -> { keep, kind, reasons }
   kind: chat | router | safety | nonchat | incapable | unavailable | exhausted | notready */
function classify(rec) {
  if (rec.available === false) {
    return {
      keep: false, kind: 'unavailable',
      reasons: [rec.unavailable_reason === 'no_key'
        ? 'needs a provider key configured on the proxy'
        : 'unavailable' + (rec.unavailable_reason ? ' (' + rec.unavailable_reason + ')' : '')]
    };
  }
  if (isRouter(rec)) return { keep: false, kind: 'router', reasons: ['router alias — cannot pin a specific model'] };
  if (isSafety(rec)) return { keep: false, kind: 'safety', reasons: ['content-moderation model'] };
  if (isNonChat(rec)) return { keep: false, kind: 'nonchat', reasons: ['not a conversational model'] };
  if (!supportsChat(rec)) return { keep: false, kind: 'incapable', reasons: ['catalog lists no chat parameters (max_tokens/temperature)'] };
  if (rec.execution_status === 'exhausted') return { keep: false, kind: 'exhausted', reasons: ['quota exhausted right now'] };
  if (rec.execution_status && rec.execution_status !== 'ready') {
    return { keep: false, kind: 'notready', reasons: ['catalog status: ' + rec.execution_status] };
  }
  return { keep: true, kind: 'chat', reasons: [] };
}

function filterModels(records) {
  const filtered = [], excluded = [];
  for (const rec of records || []) {
    if (String(rec.id) === 'auto:default') {
      excluded.push({ ids: [rec.id], reasons: ['default route — excluded from the filtered list'] });
      continue;
    }
    const c = classify(rec);
    if (c.keep) filtered.push(rec);
    else excluded.push({ ids: [rec.id], reasons: c.reasons });
  }
  return { filtered, excluded };
}

function shortAgo(at) {
  const mins = Math.max(0, Math.round((Date.now() - Number(at || 0)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

/* One-line label. Never claims "unrestricted": at best we know the model
answered a probe through this proxy. */
function labelFor(rec, probe) {
  const bits = ['chat-capable'];
  const ctx = rec.context_window || rec.context_length;
  if (ctx) bits.push(Math.round(ctx / 1000) + 'k ctx');
  if (probe && probe.ok) bits.push('probe replied ' + shortAgo(probe.at));
  else if (probe && probe.ok === false) bits.push('probe failed: ' + String(probe.note || 'error').slice(0, 40));
  else bits.push('content policy unverified');
  return bits.join(' · ');
}

const POLICY_NOTE = 'Capability metadata only. The catalog exposes no content-policy field, so no model here is verified as unrestricted — provider-level limits always apply.';

module.exports = { filterModels, classify, labelFor, shortAgo, isRouter, isSafety, isNonChat, supportsChat, POLICY_NOTE };