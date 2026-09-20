# XENIUR Arena — the first event

> Organizer documentation for the pilot and for edition one. Everything here runs on what
> M6 Part B built: Sealed Session (B1), Judging as a Scene (B2), signed documents, feeds and
> entry tickets (B3). Witness (B4) is **not** part of this event; see the last section.

## What the Arena is, in one paragraph

**XENIUR Arena makes creative work inspectable.** Participants submit the result and a signed
process record. Organizers examine recorded AI use, provenance, gaps and supporting evidence
before making their own judgments. Marketing says *process-aware judging*. It never says
AI-proof, and neither should you.

## What a record can and cannot establish

This table is on every judging surface inside XENIUR and belongs in every rules document you
publish. Do not paraphrase it into a stronger claim.

| | What it is | How far it goes |
|---|---|---|
| **Recorded provenance** | actions, versions, tools, model calls and edits XENIUR observed | directly inspectable |
| **Record integrity** | the disclosed records match one signed history; where it has gaps | cryptographically checkable, with limits |
| **Independent human contribution** | whether the participant did the work without unrecorded tools or outside help | needs additional evidence and human judgment |

A signature establishes the integrity and origin of a record, not the truth of every claim
in it. *Activity outside the recorded environment is not independently verified.*

## The flow, machine by machine

```
ORGANIZER                                   PARTICIPANT                               JUDGE
create challenge (signed) ──export──▶ adopt .xeniur-challenge.json (quarantined)
issue ticket ───────── own channel ──▶ drop .xeniur-ticket.json → verifies
                                           Seal the session → make the entry
                                           Enter what is in the centre (ticket spent)
                                           export entry package ─────────▶ (organizer imports)
close → Open judging → invite judges ─────────────────────────────────────▶ JudgingSheet, one entry at a time
                                                                            Record assessment (signed) ──▶ back
write placings → Publish results (signed) ──▶ results verify on every machine that has the challenge
```

Every arrow is a file or a feed. Nothing is hosted; there is no account and no server.

## Setting up a challenge

1. **Your identity.** Your machine signs as its publisher identity (palette → *Your models*
   is not it; identity is created on first use of any signing action). Share your public key
   with judges and participants through your own channel.
2. **Rules.** Create the challenge from the ChallengeBoard preview. Fields that matter for
   the event:
   - `aiPolicy` — `research_only` for a prelude, `no_generative_geometry` or `human_only` for
     a sprint. The verdict is computed from the record; you never adjudicate it by hand.
   - `judging.criteria` (≤ 8) and `judging.scale` — `one_to_five` or `check`. XENIUR never
     sums marks; choose a scale your panel can defend in words.
   - `entry: "ticket"` when there is a fee or a waiver. `entryNote` is your sentence about
     how to get one. XENIUR never sees a price.
3. **Publish.** *Export challenge document* writes `<title>.xeniur-challenge.json`. Send it,
   or list it in a feed.
4. **A feed** is a static JSON file at an HTTPS address:
   ```json
   { "kind": "xeniur.arena-feed/1", "label": "XENIUR Arena Algeria", "challenges": [ <the exported document>, … ] }
   ```
   Participants add the URL under *Protected Web → Challenge feeds* and press *Check the
   feeds*. Each document is verified against your signature and quarantined by your trust on
   their machine — an unknown publisher gets three a day, so tell participants to mark you
   *known* or *trusted* once they have met you.

## Tickets and money

Money never moves inside XENIUR. Collect fees on your own channel (Chargily or CIB in
Algeria, Stripe elsewhere, cash at a desk). For each paid or waived participant, *Issue a
ticket* with their public key: XENIUR writes `ticket-<key>.xeniur-ticket.json`, signed by
you, good until the challenge closes. The participant drops it on the challenge World; it
verifies, and entering spends it once. A waiver is a ticket. A refund is your business.

## The Sealed Session — what to tell participants

Before it starts, XENIUR shows the sheet and waits for the verb. Read it aloud at the
briefing; it is the whole contract:

- **Remote models: none** — local models or nothing; a request that needs a remote model is
  refused, not sent.
- **Recorded:** a heartbeat every 60 s with the Object in the centre and its version; every
  edit's origin (typed, pasted, imported, generated); every model call.
- **Not recorded:** the screen, other applications, other machines, the text typed — only
  that it was typed.
- **Shown to judges:** record density — recorded minutes, gaps, unexplained pastes — as words
  and counts, never a score. Leaving early is shown as a fact.
- **Exit:** always. Escape, or the Exit control. Leaving is recorded, not punished.

What the seal does to a verdict: a gap longer than three heartbeats across a version change,
or a paste of 400+ characters with no Source Object behind it, lowers *complies* to *the
record does not say* with the span named. Nothing the seal records can raise a verdict to
*violates* — only a model event or a generated form does that.

**Venue lockdown is your job, not XENIUR's.** If the sprint room has a policy on phones,
second laptops or network access, publish it in the rules and enforce it at the door. XENIUR
reads the record; it does not guard the room.

## Judging day

1. After close, *Open judging*. Invite the panel by public key; they become *trusted* on your
   machine.
2. For the pilot, judges sit at the organizer's machine (or a copy of it): entries and
   assessments are keyed to that machine's entry ids. Cross-machine judging works for the
   challenge, tickets and results (keyed by the challenge's signed identity); a judge's
   assessment travels back as `assessment-<id>.xeniur-judging.json` and is adopted only if it
   names an entry the organizer's machine has.
3. A judge sees one entry at a time — the deliverable, *How this came together*, *Recorded AI
   activity*, *Observation status*, the limits table — marks each criterion, writes a note,
   records, moves on. *Inspect evidence* opens the entry itself.
4. You read the assessments as each judge wrote them. There is no total, and there will not
   be one: write the placings — *First*, *Special mention*, whatever the panel decided — each
   with an entry and a reason, in your order. *Publish results* signs them with every
   finalist's process record root and verdict. *Export results file* to send them.

## The pilot

One university, ~50 people, one track, free (`entry: "open"`), a two-day window. Purpose: run
Sealed Session and Judging Sheet end to end with people who did not build them.

Watch seven things, and write down where each fails:

| Question | If it fails, it tells us |
|---|---|
| Did participants read the seal sheet, or press the verb? | the sheet is too long or too late |
| Did anyone leave a seal by Escape, and did they know it was recorded? | the exit is not visible enough, or the words frighten |
| Did the verdicts match what participants believed they did? | the policy words or the paste rule are unclear |
| Could a judge score an entry without leaving the sheet? | the sheet is missing a fact judges need |
| Did a judge mistake density for a score? | the density sentence reads like a number |
| Did the organizer try to sort entries by marks? | the console needs to say, again, why it does not |
| Were the twelve most instructive records worth showing to a sponsor? | the sales material is the records, or it is not |

## Edition one — *XENIUR Arena Algeria: Water · Sun · Digital*

Algiers, alongside Algeria 2.0 (November 2026) or a university partner. Two-week online
prelude (`research_only`) then a 48-hour on-site sprint. 40–60 teams.

| Track | Brief | Deliverables | AI policy |
|---|---|---|---|
| **Water** | cut the energy cost of a litre of desalinated or reused water, or find a leak before it is a loss | proposal, a part, an image | prelude `research_only` · sprint `no_generative_geometry` |
| **Sun** | off-grid solar for one household in the south — mount, controller, maintenance card | part, code, document | prelude `research_only` · sprint `no_generative_geometry` |
| **Digital public sphere** | one public service, one screen, usable by someone who never used it | code, image, document | prelude `research_only` · sprint `human_only` for design decisions |

Criteria, visible before entry: works on the stated problem · the making is inspectable
(record density, verdict) · claims are supported (Support Map) · a user in Adrar or Oran would
understand it. Judges: a partner engineer (SEAAL/ADE, Sonelgaz/CDER, a ministry digital team),
a designer, a past winner. Partners to approach: Algeria Venture / Ministry of Startups, UNDP
Accelerator Lab, CDER, Algeria Startup Challenge, Huawei Tech4Connect, UNESCO Global Water
Hackathon.

Fees DZD 1,500–2,500 with sponsor-funded waivers (tickets, all of them); organizer licence
DZD 150–400K per event. Then MENA / Africa ($3–8K per event, verification add-on), then global
self-serve ($500–1,500; corporate $15–30K; community challenges always free). Revenue arrives
in this order: fees (off-app) → organizer licence → sponsor presence (Source Objects with
`rights: sponsor`, never an ad slot) → process certificates for finalists → paid expert
judging → later, a participant's own Process Share page as a portfolio, at no fee.

## Witness — deliberately not in this event

Witness is an opt-in mode that would record `sha256(frontmost application id)` on change and
network reachability on change while a Sealed Session runs — never titles, content or
screenshots — and show judges counts and a hashed timeline. It is behind a pilot gate: it gets
built only if the pilot shows organizers need it **and** participants accept it. Nothing in
this document, and nothing in the product, depends on it. Do not promise it.

## Deferred, and why

Sound cues · French/Arabic and the Arabic display face (M7) · a hosted Arena server (the feed
is static and signed) · payments in-app · automatic AI-content detection (XENIUR reads the
record, it does not guess) · leaderboards of any kind · profession-based onboarding, forever.
