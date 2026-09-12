/* test.js — run with `node test.js`. No framework, no dependencies.
 *
 * These cases exist because each one was a way the engine could be quietly wrong:
 * silently mangling an ordinary word, splitting one person into three, or letting
 * an overlapping match corrupt its neighbour.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const sandbox = {};
new Function('window', fs.readFileSync(path.join(__dirname, 'deid.js'), 'utf8'))(sandbox);
const Deid = sandbox.Deid;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

function plan(text, opts) {
  opts = opts || {};
  const entities = Deid.suggestLabels(Deid.toEntities(Deid.detect(text)));
  entities.forEach(e => {
    e.include = opts.includeLow ? true : (e.confidence === 'high' || e.confidence === 'medium');
  });
  return { entities, result: Deid.apply(text, entities) };
}

function find(entities, text) {
  return entities.find(e => e.text.toLowerCase() === text.toLowerCase());
}

/* --- contact details --------------------------------------------------- */

let t = 'Email me at sarah.chen@acme-corp.com or call +49 30 1234 5678.';
let p = plan(t);
check('email is detected', !!find(p.entities, 'sarah.chen@acme-corp.com'));
check('email is replaced', !p.result.text.includes('sarah.chen@acme-corp.com'), p.result.text);
check('phone is replaced', !p.result.text.includes('1234 5678'), p.result.text);

check('a year is not a phone number',
  !Deid.detect('We shipped it in 2019 and again in 2021.').some(m => m.type === 'phone'));

check('a short number is not a phone number',
  !Deid.detect('It took about 30 minutes, maybe 45.').some(m => m.type === 'phone'));

/* --- people ------------------------------------------------------------ */

t = 'Sarah: I joined in March.\nInterviewer: And before that?\nSarah: I was at a bank.';
p = plan(t);
check('speaker label is high confidence', find(p.entities, 'Sarah').confidence === 'high');
check('speaker label is replaced everywhere', !p.result.text.includes('Sarah'), p.result.text);
check('line structure survives', p.result.text.split('\n').length === 3, JSON.stringify(p.result.text));

t = 'Sarah Chen led it. Sarah reported to Chen weekly.';
p = plan(t);
check('name variants share one pseudonym',
  find(p.entities, 'Sarah Chen').label === find(p.entities, 'Sarah').label,
  JSON.stringify(p.entities.map(e => [e.text, e.label])));

t = 'I spoke to Dr. Okafor about it.';
p = plan(t);
check('honorific reveals a surname', !!find(p.entities, 'Okafor'));

/* --- the dangerous case: a name that is also a common word ------------- */

t = 'I asked Mark to look. I asked him to mark the ones that failed.';
p = plan(t);
const mark = find(p.entities, 'Mark');
check('a name that is also a verb IS offered for review',
  !!mark, 'not detected at all — a silent miss is worse than a noisy queue');
check('...but is not pre-selected',
  mark && mark.confidence === 'low',
  mark ? 'confidence was ' + mark.confidence : 'n/a');
check('the lowercase verb is left alone',
  p.result.text.includes('to mark the ones'), p.result.text);

/* The documented blind spot: a name that only ever appears at the start of a
 * sentence carries no signal a capitalisation rule can read. Asserted here so
 * that if it ever changes, the README's limitations list has to change too. */
check('a name seen ONLY sentence-initially is a known miss',
  !Deid.detect('Mark opened the console. Then he closed it.')
    .some(m => m.type === 'person' && m.text === 'Mark'));

check('a sentence-initial ordinary word is not a candidate',
  !Deid.detect('Because the alert fired late, nobody saw it.')
    .some(m => m.type === 'person' && m.text === 'Because'));

check('weekdays are not people',
  !Deid.detect('We met on Tuesday and again on Thursday.')
    .some(m => m.type === 'person'));

/* --- organisations ----------------------------------------------------- */

t = 'She moved from Trellix GmbH to Northwind Systems last year.';
p = plan(t);
check('org with a legal suffix is detected',
  p.entities.some(e => e.type === 'org' && /Trellix/.test(e.text)),
  JSON.stringify(p.entities.map(e => [e.type, e.text])));

/* --- organisations are not lists of people ----------------------------- */

t = 'She is a senior analyst at Northwind Systems Ltd in Munich.';
p = plan(t);
check('a legal suffix does not become a person',
  !p.entities.some(e => e.type === 'person' && /^(Ltd|GmbH|Inc|Corp)$/i.test(e.text)),
  JSON.stringify(p.entities.map(e => [e.type, e.text])));
check('the org name is not also claimed as a person',
  !p.entities.some(e => e.type === 'person' && /Northwind Systems/.test(e.text)),
  JSON.stringify(p.entities.map(e => [e.type, e.text])));

/* --- overlapping spans ------------------------------------------------- */

t = 'Sarah Chen and Sarah Chen again, plus Sarah alone.';
p = plan(t);
check('longer match wins over its own substring',
  !/Sarah/.test(p.result.text) && !/Chen/.test(p.result.text), p.result.text);
check('no label is left half-written',
  !/P\d[a-z]/.test(p.result.text), p.result.text);

/* --- stability --------------------------------------------------------- */

t = 'Sarah: hello.\nRob: hi.\nSarah: bye.';
const a = plan(t).result.text, b = plan(t).result.text;
check('the same input produces the same output', a === b);

check('nothing is replaced when nothing is included',
  Deid.apply('Sarah Chen called.', []).text === 'Sarah Chen called.');

check('an empty document does not throw', Deid.detect('').length === 0);

/* --- honesty ----------------------------------------------------------- */

check('the engine ships its own limitations', Array.isArray(Deid.LIMITS) && Deid.LIMITS.length >= 4);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
