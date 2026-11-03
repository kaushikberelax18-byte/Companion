'use strict';
/* Reply hygiene: strip leaked internal reasoning from model output.

Some models (notably the free-routed ones behind FreeLLMAPI) occasionally emit
an internal "thinking process" block — numbered analysis, constraint checks,
policy evaluations — either before or after the real conversational reply.
This module removes that block and returns only the user-facing answer.

Exports: stripThinking(text) -> string
*/

const THINKING_HEAD = /^\s*(?:here'?s?|here is|let me|my|the|an?)?\s*(?:a\s+)?(?:thinking|reasoning|analysis|internal|mental|brainstorming|deliberation|walkthrough)\s*(?:process|block|log|note|draft|session|map|checklist)?\s*[:\-]?\s*(?:\n|$)/i;
const NUMBERED_STEP = /^\s*\d+\.\s+/;
const BULLET = /^\s*[-*•]\s+/;
const THINKING_META = /self.correction|refinement during|matches energy|no ai\/meta|banned openings|ready\. output matches draft|thinking process|output matches draft|constraints.*voice.*heat|aligns perfectly with her profile|character is \d+|Keeping it short and punchy|Their opening was brief|Refining for Character Voice|Character Voice|Option \d+:|for Character/i;
const ANALYSIS_ITEM = /^\s*[-*•]?\s*(?:persona|voice|tone|heat|rules|length|constraints|draft|identify|follow-up)\s*[:\-]/i;
const ANALYSIS_WORD = /\b(?:analyze|analysing|analysis|identify persona|constraints|drafting?|formulate|formulating|response|check constraints|policy|safety|voice|tone|reply size|hard rules|banned|follow-up)\b/i;

// Internal reasoning patterns that leak into responses
// These patterns indicate meta-commentary about the task, not actual dialogue.
// Must appear at start of line/paragraph as analysis, not in natural conversation.
const INTERNAL_REASONING = /^\s*(?:the user wants me to|the user is asking me to|my task is to|my role is to|the instruction|the prompt|as instructed|per the |according to the |following the |in this turn|this turn|lean into|do not announce|the user is initiating|My character is|I can play with|so this aligns|i can play|the contrast between|without over-explaining|No need to ask)\b/i;

function isThinkingLine(l) {
  if (!l.trim()) return false;
  if (NUMBERED_STEP.test(l) || BULLET.test(l) || THINKING_HEAD.test(l)) return true;
  if (ANALYSIS_WORD.test(l) || ANALYSIS_ITEM.test(l) || THINKING_META.test(l)) return true;
  if (INTERNAL_REASONING.test(l)) return true;
  return false;
}

function stripThinking(t) {
  if (!t) return t;

  // 0. Quick check: if the entire text is one block of internal reasoning
  // (starts with "The user wants me to", "This turn:", etc.), return empty.
  const fullText = t.trim();
  if (INTERNAL_REASONING.test(fullText) && fullText.length < 500 && !/[.!?]\s+[A-Z]/.test(fullText)) {
    // This looks like internal reasoning without any actual response
    return '';
  }

  // 1. If text starts with "Here's a thinking process:", split into lines and
  // find the first line that is NOT a thinking line.
  if (THINKING_HEAD.test(t)) {
    const lines = t.split('\n');
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // Check for a draft/mental label inside the line
      if (/(?:draft(?:\s+-\s+|\s+)?mental|mental\s+draft|draft)\s*[:\-]?\s*/i.test(l)) {
        const rest = l.replace(/.*(?:draft(?:\s+-\s+|\s+)?mental|mental\s+draft|draft)\s*[:\-]?\s*/i, '').trim();
        if (rest.length > 3) {
          return [rest, ...lines.slice(i + 1)].join('\n').trim();
        }
        startIdx = i + 1;
        break;
      }
      if (!isThinkingLine(l) && l.trim().length > 3) {
        startIdx = i;
        break;
      }
    }
    if (startIdx >= 0 && startIdx < lines.length) {
      const tail = lines.slice(startIdx).join('\n').trim();
      if (tail.length > 5) return tail;
    }
  }

  // 2. Split into paragraphs. Filter out paragraphs that consist entirely of thinking lines.
  const paras = t.split(/\n{2,}/);
  const clean = [];
  for (const p of paras) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    const thinkingCount = lines.filter(l => isThinkingLine(l)).length;
    // If fewer than half the lines are thinking, keep the paragraph.
    if (lines.length === 0 || thinkingCount / lines.length < 0.5) {
      clean.push(trimmed);
    }
  }

  // If we removed all paragraphs, the entire text might be one big thinking block
  // without paragraph breaks. In that case, try line-by-line filtering.
  if (clean.length === 0 && paras.length === 1) {
    const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    const cleanLines = lines.filter(l => !isThinkingLine(l));
    if (cleanLines.length > 0) {
      return cleanLines.join('\n');
    }
    // If all lines are thinking lines, check if the whole thing is internal reasoning
    if (lines.length > 0 && INTERNAL_REASONING.test(lines[0])) {
      return '';
    }
  }

  // 3. Aggressive cleanup: remove any paragraph that contains thinking patterns
  // even if mixed with dialogue (the model often interleaves them)
  const resultParas = [];
  for (const p of (clean.length > 0 ? clean : paras)) {
    const paraLines = p.split('\n').map(l => l.trim()).filter(Boolean);
    const nonThinkingLines = paraLines.filter(l => !isThinkingLine(l));
    if (nonThinkingLines.length > 0) {
      resultParas.push(nonThinkingLines.join('\n'));
    }
  }

  return resultParas.length > 0 ? resultParas.join('\n\n').trim() : t;
}

/* Detect and remove excessive repetition. Some models emit the same phrase
   dozens of times. This function finds sequences that repeat 3+ times and
   collapses them to a single occurrence. */
function dedupeRepetition(t) {
  if (!t || t.length < 50) return t;

  // Split into sentences/phrases to detect repetition
  // This split pattern is simple but covers most conversational markers
  const sentences = t.split(/(?<=[.!?])\s+/);
  if (sentences.length < 3) return t;

  const seen = new Map();
  const result = [];

  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase().replace(/[^\w\s]/g, '');
    if (key.length < 5) {
      result.push(s);
      continue;
    }

    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);

    // Keep first two occurrences, skip if we've seen it more than twice
    if (count <= 2) {
      result.push(s);
    }
  }

  // Only apply if we actually removed something
  if (result.length < sentences.length) {
    return result.join(' ');
  }
  return t;
}

/* Combined pipeline: strip thinking then dedupe */
function cleanReply(t) {
  if (!t) return t;
  let out = stripThinking(t);
  out = dedupeRepetition(out);
  return out;
}

module.exports = { stripThinking, dedupeRepetition, cleanReply };