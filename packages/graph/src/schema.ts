/**
 * Migrations are embedded as strings rather than .sql files on disk so that packaging
 * the Electron app can never leave the schema behind. Append new migrations; never edit
 * a shipped one.
 */
export interface Migration { readonly version: number; readonly name: string; readonly sql: string; }

const INIT = `
CREATE TABLE worlds (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  emoji           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  last_opened_at  INTEGER
);

CREATE TABLE objects (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  semantic_type      TEXT NOT NULL,
  title              TEXT NOT NULL,
  metadata           TEXT NOT NULL DEFAULT '{}',
  parent_id          TEXT REFERENCES objects(id) ON DELETE SET NULL,
  -- Movable head pointer into versions. Deliberately not a foreign key: objects and
  -- versions reference each other, and a head must be assignable before the row settles.
  current_version_id TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  archived_at        INTEGER
);
CREATE INDEX idx_objects_world ON objects(world_id);

CREATE TABLE blobs (
  sha256     TEXT PRIMARY KEY,
  bytes      INTEGER NOT NULL,
  mime       TEXT NOT NULL,
  ext        TEXT NOT NULL,
  refcount   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE actions (
  id                TEXT PRIMARY KEY,
  task_id           TEXT,
  world_id          TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  intent            TEXT NOT NULL,
  tool              TEXT NOT NULL,
  plan              TEXT NOT NULL,
  status            TEXT NOT NULL,
  permission_level  TEXT NOT NULL,
  provenance        TEXT NOT NULL,
  provider          TEXT,
  model             TEXT,
  tool_version      TEXT,
  generation_params TEXT NOT NULL DEFAULT '{}',
  cost              TEXT NOT NULL DEFAULT '{}',
  error             TEXT,
  receipt           TEXT,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER
);
CREATE INDEX idx_actions_task ON actions(task_id);

-- A representation answers "where did you come from and how would I reproduce you?"
-- without a join. provenance is a stored column, never a convention.
CREATE TABLE representations (
  id                    TEXT PRIMARY KEY,
  object_id             TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  modality              TEXT NOT NULL,
  format                TEXT NOT NULL,
  blob_hash             TEXT REFERENCES blobs(sha256),
  produced_by_action_id TEXT REFERENCES actions(id),
  provenance            TEXT NOT NULL,
  provider              TEXT,
  model                 TEXT,
  tool_version          TEXT,
  generation_params     TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL
);
CREATE INDEX idx_reps_object ON representations(object_id);

-- Append-only. parent_version_id is what makes branching possible: going back to an
-- earlier state forks rather than truncates, so both heads survive.
CREATE TABLE versions (
  id                TEXT PRIMARY KEY,
  object_id         TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  parent_version_id TEXT REFERENCES versions(id),
  representation_id TEXT NOT NULL REFERENCES representations(id),
  cause_action_id   TEXT REFERENCES actions(id),
  label             TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE(object_id, seq)
);
CREATE INDEX idx_versions_object ON versions(object_id);

CREATE TABLE relationships (
  id             TEXT PRIMARY KEY,
  from_object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_object_id   TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  metadata       TEXT NOT NULL DEFAULT '{}',
  created_at     INTEGER NOT NULL,
  UNIQUE(from_object_id, to_object_id, kind)
);

-- Canonical lineage. N inputs -> M outputs, each with a role, because a composite is
-- source + style + mask and not three anonymous parents. A single edge table cannot
-- express that, which is why these two tables are the source of truth.
CREATE TABLE action_inputs (
  action_id         TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  PRIMARY KEY (action_id, representation_id, role)
);

CREATE TABLE action_outputs (
  action_id         TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  PRIMARY KEY (action_id, representation_id, role)
);

-- Materialised index over action_inputs x action_outputs, written in the same
-- transaction. An index, not a second source of truth: verifyLineageConsistency()
-- asserts it always equals the derivation.
CREATE TABLE representation_edges (
  from_representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
  to_representation_id   TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
  action_id              TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL,
  PRIMARY KEY (from_representation_id, to_representation_id, action_id)
);
CREATE INDEX idx_edges_to ON representation_edges(to_representation_id);

CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL,
  tool       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  progress   REAL NOT NULL DEFAULT 0,
  detail     TEXT,
  error      TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE task_events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);

CREATE TABLE permissions (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,
  level      TEXT NOT NULL,
  decision   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX idx_permissions_scope ON permissions(scope, level);

-- Identity is a capability: scoped to a domain and a task, expiring, revocable.
CREATE TABLE session_grants (
  grant_id    TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  domain      TEXT NOT NULL,
  task_id     TEXT,
  identity_id TEXT,
  scope       TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX idx_grants_domain ON session_grants(domain);
`;

/**
 * Migration 2 — the Object model, corrected.
 *
 * Moves every mutable property off the objects row and into the version snapshot, because
 * anything left on the row is state that Undo cannot reach. A version becomes a complete
 * snapshot: properties, every simultaneous form, and the recipe revision in force.
 *
 * The backfill is honest about its limits: existing rows have no property history, so the
 * current title/type/metadata are written onto every existing version. That is the best
 * information available, not a reconstruction.
 */
const OBJECT_MODEL = `
CREATE TABLE branches (
  id              TEXT PRIMARY KEY,
  object_id       TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  head_version_id TEXT,
  created_at      INTEGER NOT NULL,
  UNIQUE(object_id, name)
);
CREATE INDEX idx_branches_object ON branches(object_id);

-- Every form that is current at a version, simultaneously. One representation per role.
CREATE TABLE version_forms (
  version_id        TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  PRIMARY KEY (version_id, role)
);
CREATE INDEX idx_version_forms_rep ON version_forms(representation_id);

-- versions gains the full snapshot; representation_id moves to version_forms.
CREATE TABLE versions_new (
  id                TEXT PRIMARY KEY,
  object_id         TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  parent_version_id TEXT REFERENCES versions_new(id),
  branch_id         TEXT,
  properties        TEXT NOT NULL,
  recipe_id         TEXT,
  cause_action_id   TEXT REFERENCES actions(id),
  label             TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE(object_id, seq)
);

INSERT INTO versions_new (id, object_id, seq, parent_version_id, branch_id, properties,
                          recipe_id, cause_action_id, label, created_at)
SELECT v.id, v.object_id, v.seq, v.parent_version_id, NULL,
       -- json() around metadata, not the bare column: json_object() would otherwise
       -- store the whole thing as a quoted *string* rather than an embedded object.
       json_object('title', o.title, 'semanticType', o.semantic_type,
                   'tags', json_array(), 'dimensions', json('null'), 'units', json('null'),
                   'settings', json(COALESCE(NULLIF(o.metadata, ''), '{}'))),
       NULL, v.cause_action_id, v.label, v.created_at
FROM versions v JOIN objects o ON o.id = v.object_id;

-- The single representation each version used to point at becomes its primary form.
INSERT INTO version_forms (version_id, representation_id, role)
SELECT v.id, v.representation_id, 'source.primary' FROM versions v;

DROP TABLE versions;
ALTER TABLE versions_new RENAME TO versions;
CREATE INDEX idx_versions_object ON versions(object_id);
CREATE INDEX idx_versions_branch ON versions(branch_id);

-- objects becomes identity and pointers only.
CREATE TABLE objects_new (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  parent_id          TEXT REFERENCES objects_new(id) ON DELETE SET NULL,
  current_version_id TEXT,
  current_branch_id  TEXT,
  created_at         INTEGER NOT NULL,
  archived_at        INTEGER
);

INSERT INTO objects_new (id, world_id, parent_id, current_version_id, current_branch_id,
                         created_at, archived_at)
SELECT id, world_id, parent_id, current_version_id, NULL, created_at, archived_at FROM objects;

DROP TABLE objects;
ALTER TABLE objects_new RENAME TO objects;
CREATE INDEX idx_objects_world ON objects(world_id);

-- Every existing Object gets the same 'main' branch a new one is created with, so
-- there is one shape of data afterwards rather than two. The tip is the object's
-- current version, and every existing version is attributed to that branch.
INSERT INTO branches (id, object_id, name, head_version_id, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
             substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' ||
             hex(randomblob(6))),
       o.id, 'main', o.current_version_id, o.created_at
FROM objects o;

UPDATE objects SET current_branch_id =
  (SELECT b.id FROM branches b WHERE b.object_id = objects.id AND b.name = 'main');

UPDATE versions SET branch_id =
  (SELECT b.id FROM branches b WHERE b.object_id = versions.object_id AND b.name = 'main')
WHERE branch_id IS NULL;
`;

/**
 * Migration 3 — recipes as versioned DAGs, and the derivation records that make staleness
 * a pure function of the graph rather than something anyone has to remember to set.
 */
const RECIPES = `
CREATE TABLE recipes (
  id               TEXT PRIMARY KEY,
  object_id        TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  revision         INTEGER NOT NULL,
  parent_recipe_id TEXT REFERENCES recipes(id),
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  UNIQUE(object_id, name, revision)
);
CREATE INDEX idx_recipes_object ON recipes(object_id);

CREATE TABLE recipe_steps (
  id                 TEXT PRIMARY KEY,
  recipe_id          TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  key                TEXT NOT NULL,
  tool               TEXT NOT NULL,
  capability_version TEXT NOT NULL,
  args               TEXT NOT NULL DEFAULT '{}',
  replay_policy      TEXT NOT NULL,
  position           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  UNIQUE(recipe_id, key)
);

CREATE TABLE recipe_step_inputs (
  step_id     TEXT NOT NULL REFERENCES recipe_steps(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL,
  source_kind TEXT NOT NULL,   -- 'form' (an Object form role) or 'step' (upstream output)
  source_ref  TEXT NOT NULL,   -- a form role, or "<step key>.<output slot>"
  accepts     TEXT NOT NULL DEFAULT '{}',
  required    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (step_id, slot)
);

CREATE TABLE recipe_step_outputs (
  step_id   TEXT NOT NULL REFERENCES recipe_steps(id) ON DELETE CASCADE,
  slot      TEXT NOT NULL,
  modality  TEXT NOT NULL,
  format    TEXT NOT NULL,
  form_role TEXT,             -- the Object form this slot publishes to, or NULL
  PRIMARY KEY (step_id, slot)
);

-- What a representation was built from, so staleness never needs a flag anyone can forget
-- to clear. Recomputing the fingerprint and comparing is the whole check.
CREATE TABLE derivations (
  representation_id  TEXT PRIMARY KEY REFERENCES representations(id) ON DELETE CASCADE,
  recipe_id          TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  step_key           TEXT NOT NULL,
  input_fingerprint  TEXT NOT NULL,
  capability_version TEXT NOT NULL,
  built_at           INTEGER NOT NULL
);
CREATE INDEX idx_derivations_recipe ON derivations(recipe_id, step_key);

-- A candidate_generation step never overwrites: it parks a candidate beside the current
-- form and waits for a person, because re-running a model destroys a choice someone made.
CREATE TABLE candidates (
  id                TEXT PRIMARY KEY,
  object_id         TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  representation_id TEXT NOT NULL REFERENCES representations(id) ON DELETE CASCADE,
  form_role         TEXT NOT NULL,
  recipe_id         TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  step_key          TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected
  created_at        INTEGER NOT NULL,
  decided_at        INTEGER
);
CREATE INDEX idx_candidates_object ON candidates(object_id, status);
`;

/**
 * Migration 4 — evidence and releases.
 *
 * Checks are evidence about a representation, not opinions about it: each one names the
 * validator that produced it and what it measured, so a readiness profile can be decided
 * from facts rather than from a model's impression.
 */
const VALIDATION = `
CREATE TABLE checks (
  id                TEXT PRIMARY KEY,
  object_id         TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  representation_id TEXT REFERENCES representations(id) ON DELETE CASCADE,
  validator         TEXT NOT NULL,
  status            TEXT NOT NULL,          -- pass | warn | fail | skipped
  summary           TEXT NOT NULL,
  detail            TEXT NOT NULL DEFAULT '{}',
  form_role         TEXT,
  at                INTEGER NOT NULL
);
CREATE INDEX idx_checks_object ON checks(object_id, validator);
CREATE INDEX idx_checks_rep ON checks(representation_id);

CREATE TABLE releases (
  id          TEXT PRIMARY KEY,
  object_id   TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  version_id  TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL,
  note        TEXT,
  evidence    TEXT NOT NULL DEFAULT '{}',   -- the readiness report as it stood at approval
  approved_at INTEGER NOT NULL
);
CREATE INDEX idx_releases_object ON releases(object_id, profile_id);
`;

/**
 * Migration 5 — Sensemaking.
 *
 * What a person consumes stops evaporating. Its meaningful atoms become Objects like
 * anything else, so they inherit identity, versions, lineage and readiness for free; these
 * tables add only what is particular to knowledge: where it came from, exactly where in
 * the source, how sure the person is, and how it relates to everything else.
 */
const SENSEMAKING = `
CREATE TABLE sources (
  id           TEXT PRIMARY KEY,
  world_id     TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL,            -- article | video | podcast | paper | note | conversation | screenshot | clip
  url          TEXT,
  title        TEXT NOT NULL,
  author       TEXT,
  published_at INTEGER,
  retrieved_at INTEGER NOT NULL,
  hash         TEXT,
  metadata     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_sources_world ON sources(world_id);

-- An atom IS an Object; this is the part that is particular to being knowledge.
CREATE TABLE atoms (
  object_id   TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  atom_type   TEXT NOT NULL,             -- claim | example | question | evidence | contradiction | person | concept | moment
  source_id   TEXT REFERENCES sources(id) ON DELETE SET NULL,
  -- Exactly where it came from: a character range, a timecode, a page. An atom that
  -- cannot be taken back to the sentence that produced it is a rumour.
  locator     TEXT NOT NULL DEFAULT '{}',
  -- The person's, not a model's, and nullable: an unrated atom shows as unrated rather
  -- than being assigned a number nobody chose.
  confidence  REAL,
  lane        TEXT,                      -- keep | question | connect | test | build | ignore
  extraction  TEXT NOT NULL DEFAULT 'manual',  -- how it was found, stated plainly
  stated_at   INTEGER NOT NULL
);
CREATE INDEX idx_atoms_source ON atoms(source_id);
CREATE INDEX idx_atoms_lane ON atoms(lane);

CREATE TABLE atom_links (
  id             TEXT PRIMARY KEY,
  from_object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_object_id   TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  relation       TEXT NOT NULL,          -- supports | contradicts | example_of | asks_about | same_as | derived_from
  note           TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE(from_object_id, to_object_id, relation)
);
CREATE INDEX idx_atom_links_to ON atom_links(to_object_id);

-- Consumption, metered. Not to gamify it — to notice when it stops converting.
CREATE TABLE intake (
  id        TEXT PRIMARY KEY,
  world_id  TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  kind      TEXT NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX idx_intake_world ON intake(world_id, at);

-- A human move: rating something, linking two ideas, writing an observation, deciding.
-- The friction counter resets on these, because these are the point.
CREATE TABLE moves (
  id       TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  note     TEXT,
  at       INTEGER NOT NULL
);
CREATE INDEX idx_moves_world ON moves(world_id, at);
`;

/**
 * Migration 6 — evidence becomes a measurement of a named subject.
 *
 * A check used to be a statement about an Object in general, which meant a rebuilt form
 * silently inherited the previous form's evidence and readiness went on passing. From here
 * a check names exactly what it measured, including the bytes, and readiness compares that
 * against what currently occupies the role.
 *
 * Existing checks have no subject and cannot be given one honestly, so they are marked
 * unbound and excluded from readiness rather than reinterpreted. Existing releases stay as
 * historical facts and stop conferring readiness on later versions.
 */
const BOUND_EVIDENCE = `
ALTER TABLE checks ADD COLUMN subject_kind      TEXT;
ALTER TABLE checks ADD COLUMN subject_id        TEXT;
ALTER TABLE checks ADD COLUMN subject_hash      TEXT;
ALTER TABLE checks ADD COLUMN validator_version TEXT NOT NULL DEFAULT '0.0.0';
ALTER TABLE checks ADD COLUMN params            TEXT NOT NULL DEFAULT '{}';
ALTER TABLE checks ADD COLUMN environment       TEXT NOT NULL DEFAULT '{}';
ALTER TABLE checks ADD COLUMN run_id            TEXT;

CREATE INDEX idx_checks_subject ON checks(subject_id, subject_hash);

-- Old rows measured something, but nothing recorded what. Left unbound on purpose: an
-- invented subject would be exactly the false confidence this migration exists to remove.
UPDATE checks SET subject_kind = 'unbound' WHERE subject_kind IS NULL;

ALTER TABLE releases ADD COLUMN profile_hash TEXT;
ALTER TABLE releases ADD COLUMN check_ids    TEXT NOT NULL DEFAULT '[]';
`;


/**
 * Migration 7 — the source behind a claim is kept, not merely referenced.
 *
 * A source used to be a title and a URL. Atoms carried character ranges into text XENIUR
 * had never stored, so the one question the whole feature exists to answer — *show me
 * exactly what this came from* — had no answer, and a page edited after capture left the
 * claim pointing at words that no longer existed.
 *
 * A source_version is the copy that was actually read: normalised text in the blob store,
 * hashed, with the extractor that produced it and whether it is only an excerpt. Two
 * captures of one article share a content_hash, which is what stops "captured twice" from
 * reading as "two sources agree".
 *
 * Candidates get their own table for the same reason evidence got a subject: a pattern
 * match is a suggestion until a person accepts it, and turning one straight into an atom
 * quietly attributed a machine's guess to the person.
 */
const DURABLE_CAPTURE = `
CREATE TABLE source_versions (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  retrieved_at   INTEGER NOT NULL,
  content_hash   TEXT NOT NULL,          -- sha256 of the normalised text
  raw_blob_hash  TEXT,                   -- original bytes, when available and permitted
  text_blob_hash TEXT NOT NULL,          -- normalised text; locators resolve against this
  extractor      TEXT NOT NULL DEFAULT 'verbatim/1',
  partial        INTEGER NOT NULL DEFAULT 0,
  canonical_url  TEXT,
  -- Who published it. Two outlets running one wire report are not two sources, and
  -- without this the map cannot tell the difference.
  publication_id TEXT,
  author         TEXT,
  published_at   INTEGER,
  rights         TEXT NOT NULL DEFAULT 'unknown'   -- unknown | permitted | restricted
);
CREATE INDEX idx_source_versions_source  ON source_versions(source_id, retrieved_at);
CREATE INDEX idx_source_versions_content ON source_versions(content_hash);

-- Which exact copy an atom came out of. Nullable: an observation of the person's own has
-- no source at all, and that is the most valuable kind.
ALTER TABLE atoms ADD COLUMN source_version_id TEXT REFERENCES source_versions(id) ON DELETE SET NULL;
CREATE INDEX idx_atoms_source_version ON atoms(source_version_id);

-- Named for capture because the plain name is taken: a candidate is already a generated
-- form waiting to be accepted. Two different things under one name is how a schema lies.
CREATE TABLE capture_candidates (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_version_id  TEXT NOT NULL REFERENCES source_versions(id) ON DELETE CASCADE,
  atom_type          TEXT NOT NULL,
  text               TEXT NOT NULL,
  locator            TEXT NOT NULL DEFAULT '{}',
  because            TEXT NOT NULL,      -- the rule that matched, in the person's words
  extractor          TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'proposed',  -- proposed | accepted | rejected | edited
  accepted_object_id TEXT REFERENCES objects(id) ON DELETE SET NULL,
  decided_at         INTEGER,
  created_at         INTEGER NOT NULL
);
CREATE INDEX idx_capture_candidates_pending ON capture_candidates(world_id, state);
CREATE INDEX idx_capture_candidates_source  ON capture_candidates(source_version_id);

-- A move is a thing a person did to something in particular. Recording it against the
-- world alone made "you thought about this" unanswerable for any single Object.
ALTER TABLE moves ADD COLUMN object_id  TEXT REFERENCES objects(id) ON DELETE SET NULL;
ALTER TABLE moves ADD COLUMN version_id TEXT REFERENCES versions(id) ON DELETE SET NULL;
CREATE INDEX idx_moves_object ON moves(object_id, at);
`;


/**
 * Migration 8 — decisions, and the second kind of edge.
 *
 * Sensemaking produced claims; the pipeline produced deliverables; nothing joined them. A
 * Decision is the join, and it is deliberately not automatic: a person says "I chose this,
 * because of that passage, assuming these things", and XENIUR keeps the citation pinned to
 * an exact stored copy so it can still be read months later.
 *
 * semantic_links exist as their own table rather than a flag on representation_edges
 * because the two propagate different things and must never be merged. Lineage propagates
 * rebuild: a changed mesh means the STL is genuinely out of date. A semantic link
 * propagates review: a changed article means somebody should look again. Rebuilding on a
 * semantic edge would manufacture confidence; reviewing on a lineage edge would bury a
 * person in prompts about arithmetic.
 */
const DECISIONS = `
CREATE TABLE decisions (
  object_id              TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  question               TEXT NOT NULL,
  chosen_option          TEXT,
  rationale              TEXT NOT NULL DEFAULT '',
  state                  TEXT NOT NULL DEFAULT 'draft',  -- draft | accepted | needs_review | superseded
  accepted_by            TEXT,
  accepted_at            INTEGER,
  -- The version that was accepted. A build binds to this, so editing a decision afterwards
  -- cannot retroactively change what a delivery was made under.
  accepted_version_id    TEXT REFERENCES versions(id) ON DELETE SET NULL,
  supersedes_decision_id TEXT REFERENCES objects(id) ON DELETE SET NULL,
  supersedes_version_id  TEXT REFERENCES versions(id) ON DELETE SET NULL
);
CREATE INDEX idx_decisions_state ON decisions(state);

CREATE TABLE decision_options (
  decision_id TEXT NOT NULL REFERENCES decisions(object_id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (decision_id, key)
);

-- What was in front of the person, pinned to the exact copy they read.
CREATE TABLE decision_evidence (
  id                TEXT PRIMARY KEY,
  decision_id       TEXT NOT NULL REFERENCES decisions(object_id) ON DELETE CASCADE,
  source_version_id TEXT REFERENCES source_versions(id) ON DELETE SET NULL,
  atom_object_id    TEXT REFERENCES objects(id) ON DELETE SET NULL,
  atom_version_id   TEXT REFERENCES versions(id) ON DELETE SET NULL,
  relation          TEXT NOT NULL DEFAULT 'informed_by',  -- supports | contradicts | informed_by
  note              TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_decision_evidence_decision ON decision_evidence(decision_id);
CREATE INDEX idx_decision_evidence_atom     ON decision_evidence(atom_object_id);

CREATE TABLE decision_assumptions (
  id             TEXT PRIMARY KEY,
  decision_id    TEXT NOT NULL REFERENCES decisions(object_id) ON DELETE CASCADE,
  text           TEXT NOT NULL,
  review_trigger TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_decision_assumptions ON decision_assumptions(decision_id);

CREATE TABLE semantic_links (
  id             TEXT PRIMARY KEY,
  from_object_id  TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  from_version_id TEXT REFERENCES versions(id) ON DELETE SET NULL,
  to_object_id    TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_version_id   TEXT REFERENCES versions(id) ON DELETE SET NULL,
  relation        TEXT NOT NULL,  -- supports | contradicts | informed_by | satisfies | review_on_change
  -- Always 'review'. Stored rather than assumed so that a future edge kind has to declare
  -- what it propagates instead of inheriting rebuild by accident.
  propagates      TEXT NOT NULL DEFAULT 'review',
  note            TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  UNIQUE(from_object_id, to_object_id, relation)
);
CREATE INDEX idx_semantic_from ON semantic_links(from_object_id);
CREATE INDEX idx_semantic_to   ON semantic_links(to_object_id);

-- A release records which accepted decisions it was made under, so a delivery can answer
-- the question the whole bridge exists for without re-deriving anything.
ALTER TABLE releases ADD COLUMN decision_ids TEXT NOT NULL DEFAULT '[]';
`;


/**
 * Migration 9 — what XENIUR noticed about your own use of it.
 *
 * Local, and only local. The point is not analytics: it is to find out whether the second
 * revision is actually easier than the first, which is the one claim the whole product
 * rests on and the one thing no amount of reasoning can settle.
 *
 * Two rules are structural rather than promised. Nothing here leaves the machine unless a
 * person exports it themselves, and every row is readable in a plain view built for that
 * purpose — a metric a person cannot see is a metric they cannot refuse.
 */
const SESSIONS = `
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  -- Time actually spent working, kept apart from time spent waiting for a render. A
  -- pipeline that is slow and a workspace that is confusing are different problems.
  active_ms  INTEGER NOT NULL DEFAULT 0,
  waiting_ms INTEGER NOT NULL DEFAULT 0,
  world_id   TEXT REFERENCES worlds(id) ON DELETE SET NULL
);

CREATE TABLE session_events (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  object_id  TEXT REFERENCES objects(id) ON DELETE SET NULL,
  -- Small and non-identifying by construction: counts, durations, which profile. Never
  -- titles, never text, never paths.
  detail     TEXT NOT NULL DEFAULT '{}',
  at         INTEGER NOT NULL
);
CREATE INDEX idx_session_events ON session_events(session_id, at);
CREATE INDEX idx_session_events_kind ON session_events(kind, at);
`;


/**
 * Migration 10 — money is reserved before it is spent.
 *
 * Checking settled spending and then dispatching is a race: two tasks can both read
 * "$4.20 spent, cap is $5" and both proceed, and the cap a person set is quietly $9.40.
 * A reservation is written in the same transaction as the check, so the second task sees
 * the first one's claim whether or not it has finished.
 *
 * Every billable attempt is recorded, including repairs and failures. A model that
 * produced unusable JSON twice still cost money, and a ledger that only counts successes
 * is a ledger that under-reports the bill.
 */
const SPEND = `
CREATE TABLE spend (
  id            TEXT PRIMARY KEY,
  task_id       TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL,
  model         TEXT,
  -- 'held' the moment a call is authorised, then 'settled' or 'released'. An abandoned
  -- hold expires rather than blocking the cap forever.
  status        TEXT NOT NULL DEFAULT 'held',   -- held | settled | released
  reserved_usd  REAL NOT NULL DEFAULT 0,
  actual_usd    REAL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  -- The provider's own id for the call, so a bill can be reconciled against this table.
  request_id    TEXT,
  -- Which attempt: a repair after unusable output is still a billable call.
  attempt       INTEGER NOT NULL DEFAULT 1,
  outcome       TEXT,                           -- ok | invalid_output | refused | error
  held_at       INTEGER NOT NULL,
  settled_at    INTEGER,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX idx_spend_open ON spend(status, expires_at);
CREATE INDEX idx_spend_task ON spend(task_id);
`;

/** Migration 11: typed definitions; values stay in versioned Object properties. */
const CONSTRAINTS = `
CREATE TABLE constraints (
  object_id  TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  unit       TEXT,
  spec       TEXT NOT NULL,
  applies_to TEXT NOT NULL
);
CREATE INDEX idx_constraints_kind ON constraints(kind);
`;

/** Migration 12: factual creative lineage and optional privacy-filtered proofs. */
const PROCESS_PROVENANCE = `
CREATE TABLE process_events (
  id            TEXT PRIMARY KEY,
  object_id     TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  version_id    TEXT REFERENCES versions(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,
  actor         TEXT NOT NULL,
  label         TEXT NOT NULL,
  tool          TEXT,
  model         TEXT,
  input_hashes  TEXT NOT NULL DEFAULT '[]',
  output_hashes TEXT NOT NULL DEFAULT '[]',
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  at            INTEGER NOT NULL
);
CREATE INDEX idx_process_events_object ON process_events(object_id, at);

CREATE TABLE process_proofs (
  id           TEXT PRIMARY KEY,
  object_id    TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  privacy      TEXT NOT NULL,
  proof_hash   TEXT NOT NULL,
  snapshot     TEXT NOT NULL,
  published_at INTEGER NOT NULL
);
CREATE INDEX idx_process_proofs_object ON process_proofs(object_id, published_at);

CREATE TABLE derivation_notices (
  id                TEXT PRIMARY KEY,
  source_object_id  TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  derived_object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  overlap           REAL NOT NULL,
  invitation        TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);
`;

const CREATOR_LAYER = `
CREATE TABLE app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE compute_entries (id TEXT PRIMARY KEY, units INTEGER NOT NULL, reason TEXT NOT NULL, quote_id TEXT, at INTEGER NOT NULL);
CREATE TABLE compute_quotes (id TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL, actual_units INTEGER);
CREATE TABLE intelligence_usage (id TEXT PRIMARY KEY, bucket TEXT NOT NULL, units INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX idx_intelligence_usage_at ON intelligence_usage(at);
CREATE TABLE installed_workflows (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, installed_at INTEGER NOT NULL);
`;

/** Migration 14: consequential external actions become durable Living Objects. */
const ACTION_RECEIPTS = `
UPDATE process_events SET kind = 'xeniur_session' WHERE kind = 'working_session';
CREATE TABLE action_receipts (
  object_id         TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  action_id         TEXT NOT NULL UNIQUE REFERENCES actions(id) ON DELETE RESTRICT,
  capability        TEXT NOT NULL,
  attempted         TEXT NOT NULL,
  plan_digest       TEXT NOT NULL,
  account_session_id TEXT,
  destination       TEXT NOT NULL,
  data_sent         TEXT NOT NULL DEFAULT '[]',
  quoted_price      TEXT,
  actual_price      TEXT NOT NULL,
  provider_response TEXT,
  at                INTEGER NOT NULL,
  outcome           TEXT NOT NULL
);
CREATE INDEX idx_action_receipts_destination ON action_receipts(destination, at);
`;


/**
 * Migration 15 — a citation existing and a citation supporting the claim are two facts.
 *
 * M3 made a claim traceable: it resolves to stored words at a locator. That was then read as
 * "sourced", and it is not. The passage may contradict the claim, bear on it obliquely, or
 * say nothing relevant. claim_support records the second fact, per citation, with who
 * checked it — and a model's check never settles anything on its own.
 *
 * stance records what kind of statement an atom is. An opinion or a hypothesis does not need
 * a source and is not "unsupported"; it is labelled for what it is. Only an assertion is ever
 * shown as lacking support.
 */
const CLAIM_SUPPORT = `
CREATE TABLE claim_support (
  id                TEXT PRIMARY KEY,
  claim_object_id   TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  source_version_id TEXT NOT NULL REFERENCES source_versions(id) ON DELETE CASCADE,
  locator           TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'unresolved',  -- supported | contradicted | ambiguous | unresolved
  checked_by        TEXT NOT NULL DEFAULT 'unchecked',   -- human | model | unchecked
  checked_at        INTEGER,
  note              TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_claim_support_claim  ON claim_support(claim_object_id);
CREATE INDEX idx_claim_support_source ON claim_support(source_version_id);

-- Existing atoms were all captured as claims about the world; that is what they are.
ALTER TABLE atoms ADD COLUMN stance TEXT NOT NULL DEFAULT 'assertion';

-- A proposal may offer citations for a claim before anyone has checked them. Kept on the
-- candidate so that accepting the claim can insist on a review first.
ALTER TABLE capture_candidates ADD COLUMN stance    TEXT NOT NULL DEFAULT 'assertion';
ALTER TABLE capture_candidates ADD COLUMN citations TEXT NOT NULL DEFAULT '[]';
`;


/**
 * Migration 16 — thinking moves leave a mark.
 *
 * Before a decision is accepted, XENIUR asks for one reason it could be wrong. The answer is
 * an assumption with a review trigger — a row that already existed — tagged as a steelman.
 * Skipping the question is allowed and is recorded as a skip, never as agreement: an
 * accepted decision always carries one or the other, and never neither.
 */
const THINKING_MOVES = `
ALTER TABLE decision_assumptions ADD COLUMN kind TEXT NOT NULL DEFAULT 'assumption';  -- assumption | steelman
ALTER TABLE decisions ADD COLUMN steelman TEXT NOT NULL DEFAULT 'none';               -- none | recorded | skipped
`;

/**
 * Migration 17 — modes and rhythm.
 *
 * A mode is a bounded, visible, leavable contract. The envelope is stored as the person set
 * it; the sheet digest proves it was shown; the exit reason is recorded, never judged.
 * Offers are recorded so that a skip can lengthen the cadence and an Inspiration can
 * terminate — never so that timing can be tuned. No table here holds a click or a dwell.
 */
const MODES = `
CREATE TABLE modes (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,             -- focus_contract | serendipity | recovery | discovery
  envelope      TEXT NOT NULL,             -- JSON, as the person set it
  sheet_digest  TEXT NOT NULL,             -- the sheet they read before starting
  world_id      TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  exit_reason   TEXT                       -- completed | left | emergency
);
CREATE INDEX idx_modes_active ON modes(kind, ended_at);

CREATE TABLE rhythm_offers (
  id          TEXT PRIMARY KEY,
  mode_id     TEXT REFERENCES modes(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,               -- open_question | review_due | cited_author | inspiration
  object_id   TEXT REFERENCES objects(id) ON DELETE CASCADE,
  pair_key    TEXT,                        -- for inspiration: the two subjects, so a pair is offered once
  offered_at  INTEGER NOT NULL,
  outcome     TEXT                         -- taken | skipped | NULL while open
);
CREATE INDEX idx_rhythm_offers_time ON rhythm_offers(offered_at);
CREATE INDEX idx_rhythm_offers_pair ON rhythm_offers(pair_key);
`;

/**
 * Migration 18 — publisher identity and safety.
 *
 * Who sent a package, how this person trusts them, what they reported, and how many packages
 * were taken from them today. Trust is set by the person and never computed. The private
 * signing key is not here and must never be: it lives in the keychain.
 */
const PUBLISHERS = `
CREATE TABLE publishers (
  id                  TEXT PRIMARY KEY,      -- base64url Ed25519 public key: the identity
  display_name        TEXT NOT NULL,
  first_seen          INTEGER NOT NULL,
  proof_history_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE publisher_trust (
  publisher_id TEXT PRIMARY KEY REFERENCES publishers(id) ON DELETE CASCADE,
  level        TEXT NOT NULL,                -- unknown | known | trusted | blocked
  set_by       TEXT NOT NULL,                -- always 'human'; stored so nothing else can claim it
  set_at       INTEGER NOT NULL
);

CREATE TABLE publisher_reports (
  id           TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  package_root TEXT,
  reason       TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  at           INTEGER NOT NULL
);
CREATE INDEX idx_publisher_reports ON publisher_reports(publisher_id, at);

CREATE TABLE import_rate (
  publisher_id TEXT NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,                -- local YYYY-MM-DD
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (publisher_id, day)
);
`;

/**
 * Migration 19 — shared Worlds and circles.
 *
 * A World gains a kind: `work` (yours), `critique` (someone else's work, read-only here, with
 * your review beside it) and, later, `challenge`. A critique World remembers whose work it
 * holds. Circles are opt-in groups around commitments: members are publishers, milestones
 * are Constraint Objects, and there is no score anywhere.
 */
const SHARED_WORLDS = `
ALTER TABLE worlds ADD COLUMN kind TEXT NOT NULL DEFAULT 'work';   -- work | critique | challenge
ALTER TABLE worlds ADD COLUMN publisher_id TEXT REFERENCES publishers(id) ON DELETE SET NULL;

-- Who sent each imported Object. An Object in a critique World that arrived this way is
-- read-only here: the reviewer's own Objects sit beside it and link to it by id.
CREATE TABLE imported_from (
  object_id    TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  publisher_id TEXT NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  package_root TEXT NOT NULL,
  imported_at  INTEGER NOT NULL
);

CREATE TABLE circles (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE circle_members (
  circle_id    TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  publisher_id TEXT NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (circle_id, publisher_id)
);
CREATE TABLE circle_milestones (
  circle_id            TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  constraint_object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  PRIMARY KEY (circle_id, constraint_object_id)
);
`;

/**
 * Migration 20 — delegated outreach.
 *
 * A campaign is the envelope the person approved, once, and a count. Every send is an
 * action with a receipt; the sends table is the join between the two so "how many, to whom,
 * with what outcome" is one query and never an estimate.
 */
const OUTREACH = `
CREATE TABLE outreach_campaigns (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  envelope      TEXT NOT NULL,             -- JSON, as approved
  authorization TEXT NOT NULL,             -- JSON: the approval over the campaign plan
  sent          INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'active',   -- active | exhausted | expired | revoked
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_outreach_world ON outreach_campaigns(world_id, created_at);

CREATE TABLE outreach_sends (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  action_id   TEXT NOT NULL REFERENCES actions(id) ON DELETE RESTRICT,
  recipient   TEXT NOT NULL,
  outcome     TEXT NOT NULL,               -- sent | refused | failed
  at          INTEGER NOT NULL
);
CREATE INDEX idx_outreach_sends ON outreach_sends(campaign_id, at);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "init", sql: INIT },
  { version: 2, name: "object_model", sql: OBJECT_MODEL },
  { version: 3, name: "recipes", sql: RECIPES },
  { version: 4, name: "validation", sql: VALIDATION },
  { version: 5, name: "sensemaking", sql: SENSEMAKING },
  { version: 6, name: "bound_evidence", sql: BOUND_EVIDENCE },
  { version: 7, name: "durable_capture", sql: DURABLE_CAPTURE },
  { version: 8, name: "decisions", sql: DECISIONS },
  { version: 9, name: "sessions", sql: SESSIONS },
  { version: 10, name: "spend", sql: SPEND },
  { version: 11, name: "constraints", sql: CONSTRAINTS },
  { version: 12, name: "process_provenance", sql: PROCESS_PROVENANCE },
  { version: 13, name: "creator_layer", sql: CREATOR_LAYER },
  { version: 14, name: "action_receipts", sql: ACTION_RECEIPTS },
  { version: 15, name: "claim_support", sql: CLAIM_SUPPORT },
  { version: 16, name: "thinking_moves", sql: THINKING_MOVES },
  { version: 17, name: "modes", sql: MODES },
  { version: 18, name: "publishers", sql: PUBLISHERS },
  { version: 19, name: "shared_worlds", sql: SHARED_WORLDS },
  { version: 20, name: "outreach", sql: OUTREACH },
];
