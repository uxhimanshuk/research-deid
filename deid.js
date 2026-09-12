/* deid.js — detection and redaction engine for research transcripts.
 *
 * Pure functions over strings. No DOM, no storage, no network — this file is
 * deliberately dependency-free and side-effect-free so that "nothing leaves the
 * machine" is verifiable by reading it rather than by trusting a claim.
 *
 * The engine proposes; it never decides. Every match it finds is a candidate for
 * a human to confirm, which is why detect() returns confidence bands instead of
 * a boolean and why nothing here writes back into the text on its own.
 */
(function (global) {
  'use strict';

  /* Capitalised words that are almost never the name of a person or company in a
   * research transcript. Without this list, every sentence-initial word and every
   * weekday becomes a candidate and the review queue is unusable. It is
   * deliberately conservative: a word here can still be caught by another rule
   * (an honorific, a speaker label) and can always be added by hand. */
  var COMMON = ('a about after all also am an and another any are as at back be because been before being but by ' +
    'can could did do does doing done down each either else even ever every few first for from get give go had has ' +
    'have having he her here hers him his how however i if in into is it its just kind like little look make many ' +
    'may me might more most much must my never new next no nor not now of off often on once one only or other our ' +
    'out over own perhaps please probably put quite rather really right said same say see she should since so some ' +
    'something sometimes still such sure take than that the their them then there these they thing think this those ' +
    'though through thus to too under up us use used very want was way we well were what when where whether which ' +
    'while who why will with within without would yeah yes yet you your ' +
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'january february march april may june july august september october november december ' +
    'english german french spanish italian dutch hindi mandarin japanese american british european indian ' +
    'ok okay yep nope hmm uh um mm hi hello thanks thank sorry sorted ' +
    'android ios windows mac linux chrome safari firefox excel word powerpoint slack zoom teams figma jira ' +
    'api ui ux saas crm sso vpn url pdf csv json html css url gdpr soc siem edr mfa ' +
    'q1 q2 q3 q4 covid').split(' ');

  var COMMON_SET = Object.create(null);
  COMMON.forEach(function (w) { COMMON_SET[w] = true; });

  var HONORIFIC = '(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Sir|Dame|Herr|Frau|Monsieur|Madame|Señor|Señora)';
  var ORG_SUFFIX = '(?:Inc|LLC|L\\.L\\.C|Ltd|Limited|GmbH|AG|KG|Corp|Corporation|Co|Company|PLC|LLP|Pvt|' +
    'B\\.V|N\\.V|S\\.A|S\\.r\\.l|Oy|AB|A\\/S|Group|Holdings|Technologies|Labs|Systems|Solutions|Partners)';

  var RULES = [
    { type: 'email', confidence: 'high',
      re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },

    { type: 'url', confidence: 'high',
      re: /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+/gi },

    /* Requires 7+ digits so that "in 2019" and "about 30 minutes" don't flood the
     * queue. Still catches loose formats like "+49 30 1234 5678". */
    { type: 'phone', confidence: 'high',
      re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d(?:[\d\s.-]{5,14})\d/g,
      validate: function (m) { return (m.replace(/\D/g, '').length >= 7); } },

    /* Speaker labels at the start of a line: "Sarah:", "Sarah Chen:", "[Rob]:".
     * The most reliable name signal a transcript has. */
    { type: 'person', confidence: 'high', group: 1,
      re: /^[ \t]*\[?([A-Z][A-Za-z'’-]+(?:[ \t]+[A-Z][A-Za-z'’-]+){0,2})\]?[ \t]*[:：]/gm },

    { type: 'person', confidence: 'high', group: 1,
      re: new RegExp(HONORIFIC + '\\.?\\s+([A-Z][A-Za-z\'’-]+(?:\\s+[A-Z][A-Za-z\'’-]+)?)', 'g') },

    { type: 'org', confidence: 'high', group: 1,
      re: new RegExp('\\b([A-Z][A-Za-z0-9&.\'’-]*(?:\\s+[A-Z][A-Za-z0-9&.\'’-]*){0,3}\\s+' + ORG_SUFFIX + ')\\.?\\b', 'g') },

    /* Two or more capitalised words in a row — "Sarah Chen", "North Rhine".
     * Genuinely ambiguous, so it lands in review pre-checked but visible. */
    { type: 'person', confidence: 'medium',
      re: /\b[A-Z][a-z'’-]{1,}(?:\s+[A-Z][a-z'’-]{1,}){1,2}\b/g },

    /* A single capitalised word mid-sentence. Very noisy, so it is surfaced
     * unchecked: the researcher opts in rather than out. */
    { type: 'person', confidence: 'low',
      re: /\b[A-Z][a-z'’-]{2,}\b/g }
  ];

  function isCommon(text) {
    var parts = text.toLowerCase().split(/[\s'’-]+/);
    return parts.every(function (p) { return !p || COMMON_SET[p]; });
  }

  /* True when the match begins a sentence, where capitalisation says nothing
   * about whether the word is a name. */
  function sentenceInitial(text, index) {
    var i = index - 1;
    while (i >= 0 && /[\s"'“‘(]/.test(text[i])) { i--; }
    return i < 0 || /[.!?:;•\n]/.test(text[i]);
  }

  /* A capitalised token that also appears lowercase elsewhere in the same
   * document is usually an ordinary word that happened to start a sentence. */
  function appearsLowercase(text, token) {
    if (token.length < 3) { return false; }
    var lower = token.toLowerCase();
    var re = new RegExp('\\b' + lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    var m;
    while ((m = re.exec(text)) !== null) {
      if (text.substr(m.index, lower.length) === lower) { return true; }
    }
    return false;
  }

  function contextOf(text, start, end) {
    var before = text.slice(Math.max(0, start - 45), start).replace(/\s+/g, ' ');
    var after = text.slice(end, Math.min(text.length, end + 45)).replace(/\s+/g, ' ');
    return { before: before, match: text.slice(start, end), after: after };
  }

  /* Find every candidate. Returns raw matches; grouping into entities is a
   * separate step so that the two can be reasoned about independently. */
  function detect(text) {
    var out = [];
    RULES.forEach(function (rule) {
      var re = new RegExp(rule.re.source, rule.re.flags);
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }
        var raw = rule.group ? m[rule.group] : m[0];
        if (!raw) { continue; }
        var start = rule.group ? m.index + m[0].indexOf(raw) : m.index;
        var end = start + raw.length;
        var value = raw.trim();
        if (!value) { continue; }
        if (rule.validate && !rule.validate(value)) { continue; }

        if (rule.type === 'person' || rule.type === 'org') {
          if (isCommon(value)) { continue; }
          /* Sentence position only tells us anything about a *single* capitalised
           * word. In "Sarah Chen led it" the signal is the second capital, which
           * survives being at the start of a sentence. */
          var multiword = /\s/.test(value);
          if (rule.confidence === 'low' && !multiword && sentenceInitial(text, start)) { continue; }
          /* A word that also appears lowercase in the same document ("Mark" vs
           * "mark them in bulk") is the case most likely to be a name AND most
           * likely to be an ordinary word. It stays in the queue, unselected, so
           * the researcher rules on it — dropping it would be a silent miss on
           * precisely the ambiguity this tool exists to surface. */
        }
        out.push({
          type: rule.type, text: value, start: start, end: end,
          confidence: rule.confidence, context: contextOf(text, start, end)
        });
      }
    });

    /* An organisation's name is not also a list of people. "Northwind Systems Ltd"
     * matches the multi-capital person rule too; without this the company becomes a
     * person and "Ltd" becomes another one. */
    var orgSpans = out.filter(function (m) { return m.type === 'org'; });
    out = out.filter(function (m) {
      if (m.type !== 'person') { return true; }
      return !orgSpans.some(function (o) { return o.start <= m.start && o.end >= m.end; });
    });
    var SUFFIX_RE = new RegExp('^' + ORG_SUFFIX + '$', 'i');

    /* Known-name propagation. Once a strong signal establishes that "Sarah Chen"
     * is a person, every bare "Sarah" and "Chen" in the document has to be caught
     * too — wherever it sits in a sentence. Without this the scrub leaks exactly
     * where a transcript is chattiest: second and later mentions. */
    var known = Object.create(null);
    out.forEach(function (m) {
      if (m.type !== 'person' || m.confidence === 'low') { return; }
      m.text.split(/[\s'’-]+/).forEach(function (tok) {
        if (tok.length > 2 && !COMMON_SET[tok.toLowerCase()] && !SUFFIX_RE.test(tok)) { known[tok] = true; }
      });
    });
    Object.keys(known).forEach(function (tok) {
      var re = new RegExp('\\b' + escapeRe(tok) + '\\b', 'g');
      var m;
      while ((m = re.exec(text)) !== null) {
        if (text.substr(m.index, tok.length) !== tok) { continue; }   // capitalisation must match
        var end = m.index + tok.length;
        /* An existing weak guess at exactly this span is the same finding, now
         * corroborated — promote it rather than skipping, or the weak match
         * shadows the strong one and the mention survives the scrub. */
        var exact = null, covered = false;
        for (var i = 0; i < out.length; i++) {
          var o = out[i];
          if (o.start === m.index && o.end === end) { exact = o; }
          else if (o.start <= m.index && o.end >= end) { covered = true; }
        }
        if (exact) { exact.confidence = 'high'; continue; }
        if (covered) { continue; }
        out.push({
          type: 'person', text: tok, start: m.index, end: end,
          confidence: 'high', context: contextOf(text, m.index, end)
        });
      }
    });
    return out;
  }

  var RANK = { high: 3, medium: 2, low: 1 };

  /* Collapse matches into one entity per distinct surface form, keeping the
   * highest confidence any rule assigned it and a few example contexts. */
  function toEntities(matches) {
    var byKey = Object.create(null);
    matches.forEach(function (m) {
      var key = m.type + '\u0000' + m.text.toLowerCase();
      if (!byKey[key]) {
        byKey[key] = { type: m.type, text: m.text, count: 0, confidence: m.confidence, contexts: [] };
      }
      var e = byKey[key];
      e.count++;
      if (RANK[m.confidence] > RANK[e.confidence]) { e.confidence = m.confidence; e.text = m.text; }
      if (e.contexts.length < 3) { e.contexts.push(m.context); }
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; })
      .sort(function (a, b) {
        return RANK[b.confidence] - RANK[a.confidence] || b.count - a.count ||
          a.text.toLowerCase().localeCompare(b.text.toLowerCase());
      });
  }

  var PREFIX = { person: 'P', org: 'ORG', email: 'EMAIL', phone: 'PHONE', url: 'URL', custom: 'TERM' };

  function labelFor(type, n) {
    if (type === 'person') { return 'P' + n; }
    if (type === 'org') { return n <= 26 ? '[ORG-' + String.fromCharCode(64 + n) + ']' : '[ORG-' + n + ']'; }
    return '[' + PREFIX[type] + '-' + n + ']';
  }

  /* Assign pseudonyms. Two entities that share a name token get the same label,
   * so "Sarah Chen", "Sarah" and "Chen" all become P1 rather than three
   * different people — which is what makes the scrubbed transcript still
   * analysable. The caller can override any label afterwards. */
  function suggestLabels(entities) {
    var counters = Object.create(null);
    var tokenOwner = Object.create(null);
    entities.forEach(function (e) {
      if (e.label) { return; }
      var tokens = e.type === 'person'
        ? e.text.toLowerCase().split(/[\s'’-]+/).filter(function (t) { return t.length > 2 && !COMMON_SET[t]; })
        : [];
      var owned = null;
      for (var i = 0; i < tokens.length; i++) {
        if (tokenOwner[tokens[i]]) { owned = tokenOwner[tokens[i]]; break; }
      }
      if (owned) {
        e.label = owned;
      } else {
        counters[e.type] = (counters[e.type] || 0) + 1;
        e.label = labelFor(e.type, counters[e.type]);
      }
      tokens.forEach(function (t) { if (!tokenOwner[t]) { tokenOwner[t] = e.label; } });
    });
    return entities;
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Replace by resolved span rather than by successive string replacement:
   * overlapping candidates ("Sarah" inside "Sarah Chen") must not corrupt each
   * other, and the longest match has to win. */
  function apply(text, entities) {
    var active = entities.filter(function (e) { return e.include && e.label; });
    if (!active.length) { return { text: text, replacements: 0 }; }

    var spans = [];
    active.forEach(function (e) {
      var boundary = /^[\w]/.test(e.text) && /[\w]$/.test(e.text);
      var src = boundary ? '\\b' + escapeRe(e.text) + '\\b' : escapeRe(e.text);
      var re = new RegExp(src, 'gi');
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }
        spans.push({ start: m.index, end: m.index + m[0].length, label: e.label });
      }
    });

    spans.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });

    var out = '';
    var cursor = 0;
    var used = 0;
    spans.forEach(function (s) {
      if (s.start < cursor) { return; }        // already covered by a longer span
      out += text.slice(cursor, s.start) + s.label;
      cursor = s.end;
      used++;
    });
    out += text.slice(cursor);
    return { text: out, replacements: used };
  }

  /* What the engine cannot do. Stated in code because it belongs next to the
   * code, and mirrored in the UI so no one has to read the source to find out. */
  var LIMITS = [
    'A name that only ever appears at the start of a sentence. "Mark opened the console" carries no signal a capitalisation rule can read, so it is not offered at all.',
    'Identifying detail that is not a name: a job title in a small team, a rare medical condition, an unusual role at a named employer.',
    'Two different people who share a first name. They merge into one pseudonym, because the engine links names by their tokens and cannot tell them apart. Split them by hand in the review step.',
    'Anything in an image, a screenshot or a PDF — this reads plain text only.',
    'Re-identification by combination. Removing every name does not stop "the only female VP in our Munich office" identifying someone.',
    'Languages and scripts its capitalisation rules do not fit. Non-Latin scripts are not detected at all.',
    'Text that is not an interview. The person rules assume a capitalised token is usually a name, which holds in a transcript and fails on technical writing, where it is usually a product — "Let\'s Encrypt" and "Google Analytics" are both detected as people. Measured on a forum corpus, not a guess.',
    'Numbers that are not phone numbers. On the same corpus the phone rule matched software version numbers, IP addresses, dates and forum post ids. Both of these are why the review step exists; neither is safe to auto-apply outside an interview transcript.'
  ];

  global.Deid = {
    detect: detect,
    toEntities: toEntities,
    suggestLabels: suggestLabels,
    apply: apply,
    LIMITS: LIMITS,
    _internals: { isCommon: isCommon, sentenceInitial: sentenceInitial, labelFor: labelFor }
  };
})(typeof window !== 'undefined' ? window : this);
