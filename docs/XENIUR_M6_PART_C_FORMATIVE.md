# Testing Part C with people

> Five to eight people, each with their own unfinished work — never the Rainwear demo. Two
> hours each. You are watching where the interface is wrong, not where the person is.

## What is being tested

The sentence: **the plan guides the work, the person controls the work, and the browser is one
of the places where the work happens.** Everything below is a way of finding out whether that
is true of the build, or only of the documentation.

## Before they arrive

- A machine with no model key, on purpose. Everything in Part A must work without one.
- One account they are willing to sign into in front of you — a supplier portal, a library, a
  university system. Never a bank, never anything with money in it.
- `npm run demo:guided` and `npm run demo:browser` green, so a failure in the session is theirs
  to find rather than yours to discover.

## The tasks

Give the task, then stop talking. Do not explain a screen; if they ask what something does,
ask what they think it does first, and write down the answer.

1. **Start.** "Open XENIUR with something you actually want to get done this week."
2. **The plan.** Let them meet the proposed steps without comment. Then: "Make this plan say
   what you would actually do."
3. **Bring something in.** "Find something on the web you would use for this." Let them reach
   for browsing themselves; if they cannot find it, that is the finding.
4. **Sign in.** Only if their task needs it. Watch what they expect to happen to the assistant
   when they do.
5. **Save and compare.** "Save the part that matters and set it beside what it has to satisfy."
6. **A change.** Edit the requirement for them, out loud: "Your client changed this." Watch
   what they expect to have happened to their comparison.
7. **Finish.** "Finish this." (It will be refused. Watch what they do with the refusal.)
8. **Come back.** Close XENIUR. Reopen it the next day if you can, or after a break. "Carry on."

## The seven things to watch

| Question | A failure tells you |
|---|---|
| Can they say their goal, their current step and their next action within ten seconds of looking at the workspace? | the dock and the rail are not carrying the work |
| Did they edit the plan, or obey it? | the plan reads as instructions rather than a proposal |
| Did anyone read *skipped* as *done*? | the word or the count is lying |
| Where did they expect "Save to project" to be? | the browser and the project are not one place |
| After sign-in, did they think the assistant could now read the page? | the four permissions are not visible as four |
| What did they do with the Finish refusal? | the missing things are not actionable, or the rationale field reads as a dismissal |
| After coming back: did they carry on, or re-read? | the position restored the place but not the thread |

## What to record

Only what you saw. A sentence per moment, with the time and the exact words they used. No
scores, no ratings, no "found it difficult" — write what they did and what they said.

Specifically worth capturing verbatim:

- the first thing they said when the proposed plan appeared;
- what they called each part of the screen without being told (plan? steps? the list?);
- the moment they first reached for the web, and what they reached with;
- what they said the assistant could do after signing in;
- what they said *uncertain* meant on a receipt, if they got that far.

## What not to do

- Do not demonstrate first. A thing you have to show is a thing the interface did not say.
- Do not ask them to rate anything.
- Do not let an action reach anything real. The service route stays pointed at a receiver you
  control; the browser goes nowhere that spends money.
- Do not defend a screen. Write the objection down as it was said.

## Afterwards

Write one page per person: what they were trying to do, where they stopped, what they said.
Then one page across all of them: only the things two or more people did. A single person's
difficulty is a note; two people's is a defect.

Do not change anything during the sessions. A build that moves under the testers gives you
eight opinions about eight different products.
