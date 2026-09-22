# The controlled browser — routes, permissions, grants

> Design for M6 Part C, workstream B. Written before the code, and kept true by it.
> The sentence this serves: **the plan guides the work, the person controls the work, and the
> browser is one of the places where the work happens — not a separate application and not an
> unrestricted agent.**

## Three routes, and what is built

| Route | What it is | This milestone |
|---|---|---|
| **Embedded browser** | Tabs inside XENIUR, on their own sessions, with sign-in profiles the person creates. The assistant can act only in a tab the person can see. | **Built** |
| **Official service API** | A request to an endpoint the person configured, with their own token, carrying exactly the payload they reviewed. | **Built** (one generic adapter) |
| **Companion system browser** | Driving the person's own Chrome/Safari through an extension. | **Spike outcome only.** It is a different identity with no visibility binding, it needs an extension review on someone else's timetable, and nothing in Part C depends on it. Not built, not promised. |

## Four permissions, kept apart

A person signing in is not an instruction to read; reading is not an instruction to send; a
draft is not an instruction to act. Each of these is its own grant, and one never implies the next.

| Permission | What it allows | What it never allows |
|---|---|---|
| **Website access** | The person signs in to a site in a profile they chose. Their session lives in that profile. | The assistant to read the page, or to act |
| **Assistant observation** | The assistant reads the named tab, at the named origins, for this task | Sending what it read anywhere |
| **Model disclosure** | Approved material may go to a named destination (a local or remote model) for a stated purpose | Any action, and any material the person excluded |
| **Assistant action** | One reviewed operation, of a named class, in the named tab or through the named route | Anything the person did not review |

## What a grant binds

Every grant carries, and is checked against:

- a **grant id and revision** — amending is a new revision; the old one stops working;
- the **route** (`embedded_tab` or `service_api`);
- the **profile**, the **tab** and the **webContents id** — the exact visible view, not "a tab";
- the **origins** it covers;
- the **account label**, and that a *person* verified it (a matching display name is not proof of identity);
- the **project** and **goal**;
- the **data versions** approved — versions, not objects, so an edit is outside the grant;
- the **model destinations** allowed;
- the **action classes** allowed (`read`, `fill`, `click`, `submit`, `api_post`);
- for a consequential action: the **reviewed action digest**, the **payload versions**, and
  whether it is **one use** or bounded repeats;
- an **expiry**, and **limits** (how many actions, and an amount where money is named).

## Where grants are enforced

Three places, in the trusted process, never in the renderer:

1. **Before reading a page** — the driver asserts an `observation` grant for that tab, that
   webContents and the current origin.
2. **Before anything reaches a model** — the context compiler excludes material with no
   covering `model_disclosure` grant for the resolved destination, and says so by reason.
3. **At dispatch** — two independent gates: the grant is asserted (class, digest, one-use,
   limits, expiry) *and* the permission broker guards the plan, as outreach already does.

A queued action is re-checked when it is dispatched, never only when it was queued.

## Lifecycle

| What happens | The assistant's authority | What remains |
|---|---|---|
| **Take over / pause** | Paused: no new reading, no transmission, no action; input control returns to the person. Resuming needs an explicit act and a re-check. | Manual browsing, drafts, everything already saved |
| **Stop / revoke** | The grant is revoked; queued work that depended on it is refused at dispatch. | Saved work and the attempt history; what was already sent cannot be recalled, and the receipt says so |
| **Change account or profile** | Identity-bound grants are revoked; nothing from the old session reaches the new one. | A separate manual session, and the project's saved material |
| **Leave the project** | Foreground delegation is suspended. | Tabs and plan, resumable; the next project inherits nothing |
| **Navigate out of scope** | Paused with the reason `out_of_scope`. | Ordinary manual navigation |
| **Expiry, restart, crash** | Every grant is revoked at startup. A restored position restores no authority; an attempt that was in flight becomes *uncertain*, never *failed* or *confirmed*. | Manual sign-in, local artifacts, a reviewable recovery |

## What can never mint a grant

Page text, an authenticated page, a download, an email, a document, a model's output. Only the
person, through XENIUR's own interface, and only in the trusted process. A test holds
`grants.issue(` to the IPC layer: it may not be called from the web or route code.

## What the embedded route does and does not relax

A profile the person signs into may POST — that is how signing in works — and its pages are not
forced through `form-action 'none'`. Everything else stays: HTTPS only, the address policy on
every frame, the reputation check, the per-session pinned proxy to the checked IP, no
privileged preload, no popups, no webview, downloads written to a scratch folder and offered to
the person rather than taken. While the assistant is acting in a tab, non-GET requests from that
view to origins outside the grant are cancelled: the page cannot use the assistant's turn to
post somewhere else.

## Why the driver is not Playwright

`@xeniur/hands` drives a separate Chromium with no storage state — deliberately, and it stays
that way. A separate browser is a separate identity, so an action there is not an action in the
session the person signed into, and the person cannot watch it happen. The embedded driver
works on the tab's own `webContents`: it reads through a fixed, bundled script in an isolated
world (never the main world, never code a model wrote) and acts through synthesised input
events at the element's own position, so the page's handlers run and the person sees the
cursor. Full CDP is not used: it is a shell by another name.

## What is deliberately not here

Copying cookies between browsers · storing a password or typing one · multi-account detection
per origin (the account label is text a person verified) · automatic retry after an uncertain
outcome · any screenshot leaving the machine.
