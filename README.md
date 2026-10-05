# research-deid

Strip names, emails, phone numbers and organisations out of interview transcripts
before they go anywhere else — an LLM, a shared drive, a slide, a colleague's inbox.

**[Open the tool →](https://uxhimanshuk.github.io/research-deid/)**

It runs entirely in the tab. No upload, no account, no server, no storage. Save the
page and it works offline, from a file, on a plane.

---

## Why

Research teams are pasting transcripts into language models, and the transcripts are
full of the one thing participants were promised would be protected. The usual
options are a compliance product nobody has budget for, or find-and-replace in a
text editor at midnight.

This sits in between: a fast first pass that removes the obvious and the
repetitive, and shows you everything it wasn't sure about.

## What makes it usable afterwards

Anonymising a transcript is easy. Anonymising it while keeping it *analysable* is
the actual problem, and it comes down to consistency:

- **Pseudonyms are stable.** "Sarah Chen", "Sarah" and "Chen" all become `P1`, so
  you can still follow who said what, count who raised which theme, and quote them.
- **They're stable across files too.** Load a whole study's transcripts at once and
  `P1` is the same person in all of them.
- **Structure survives.** Speaker labels, line breaks and timestamps come out
  intact, so it still opens cleanly in whatever you code in.

## The review step is the point

Nothing is replaced until you say so. Every candidate is listed with the text
around it and a confidence band:

| | |
|---|---|
| **high** | a speaker label, an honorific, an email, a phone number, an org with a legal suffix — pre-selected |
| **medium** | two or more capitalised words in a row — pre-selected |
| **low** | a single capitalised word mid-sentence — listed, **not** selected |

That third band is the whole design. A word like "Mark", in a transcript that also
says "mark the ones that failed", is both a likely name and a likely verb. A tool
that decides silently will eventually decide wrong, and you'll find out when the
transcript reads strangely or when a name survives into a deck. So it goes in the
queue, unticked, and you rule on it.

You can also relabel anything (give two entries the same label to merge them into
one person) and add terms it missed — an internal product name, a team nickname.

## What it will not catch

Stated in the tool as well as here, because nobody reads the README first:

- **A name that only ever appears at the start of a sentence.** "Mark opened the
  console" has no signal a capitalisation rule can read. Not offered at all.
- **Two different people with the same first name.** They merge into one pseudonym.
  Split them by hand in review.
- **Identifying detail that isn't a name** — a job title in a team of four, a rare
  condition, an unusual role at a named employer.
- **Re-identification by combination.** Removing every name does not stop "the only
  female VP in our Munich office" identifying someone.
- **Anything that isn't plain text** — images, screenshots, PDFs.
- **Non-Latin scripts**, which the capitalisation rules don't fit at all.

This is a first pass, not a compliance control. Read the output before you trust
it. If a miss would harm a participant, read it twice.

### It is for interview transcripts, and it shows outside one

Measured rather than assumed. Run over a corpus of technical forum posts in
[`clicked-through`](https://github.com/uxhimanshuk/clicked-through), it changed 647
items with 3,205 replacements, and most of them were wrong.

The person rules assume a capitalised token is usually a name. That holds in a
transcript. In technical writing a capitalised token is usually a product, so
**"Let's Encrypt", "Monte Carlo" and "Google Analytics" were all detected as
people.** Restricting it to phone numbers was no better: it matched software
version numbers, IP addresses, dates and forum post ids.

That study ended up scrubbing only email addresses, and said so in its method.

Two things follow. The tool is scoped to interview transcripts and should not be
pointed at prose of another kind without checking every replacement. And this is
the clearest argument for the review step: run without one, it would have quietly
rewritten the corpus a study depended on, and the damage would have looked like
data.

## The key file

Exporting gives you the scrubbed transcript and, separately, a key mapping each
pseudonym back to the real value. The key is the one artifact that can undo all of
this — keep it somewhere the transcripts are not, and delete it when the study
closes.

## Verifying the privacy claim

The claim is that nothing leaves your machine, so it shouldn't be taken on trust:

- Open devtools, go to the Network tab, and use the tool. Nothing appears.
- `grep -nE 'fetch|XMLHttpRequest|WebSocket|localStorage' *.js *.html` returns
  nothing. There is no code that could send or store anything.
- There are no webfonts, no CDN, no analytics. System font stacks only —
  a single Google Fonts request would contradict the whole premise.
- `deid.js` is ~250 lines of plain functions over strings, meant to be read.

## Running and testing it

```sh
open index.html     # that's it — no build, no server, no dependencies
node test.js        # 25 cases, no framework
```

The tests are the interesting file. Each case is a way the engine could be quietly
wrong: an overlapping match corrupting its neighbour, one person splitting into
three, a legal suffix becoming a person, an ordinary word being mangled. The known
blind spot above is asserted as a test too, so if the behaviour ever changes this
README has to change with it.

---

Built by [Himanshu Kalra](https://himanshukalra.com). MIT licensed.
