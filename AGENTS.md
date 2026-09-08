# Lectern — agent instructions

## `main` is protected

**Never commit or push directly to `main`.** Every change reaches `main` through a
pull request, including one-line fixes and documentation.

The only exception is an explicit human instruction to do otherwise, given for that
specific change. A general approval earlier in a session does not carry forward, and
"cleanup" or "just push it" without naming `main` is not an exception — ask.

Work always starts by branching off an up-to-date `main`:

```bash
git checkout main && git pull
git checkout -b <type>/<description>
```

## The user's data is not replaceable

A lecture's transcript and notes exist in exactly one place: `prisma/dev.db`. There
is no server copy and no export. Treat that file as the only copy of a semester's
work, because it is.

- **Snapshot before touching the schema or the data.** `npm run db:migrate` takes a
  snapshot first, and `npm run db:backup` takes one on demand. Snapshots live in
  `prisma/backups/` (git-ignored, newest 20 kept).
- **Every destructive action says what it destroys, before it happens.** A delete
  or a regenerate that cascades names the flashcards, questions, or review progress
  that go with it. A count in a button label is not a warning.
- **Prefer a new column to an overwrite.** Transcript cleanup writes `cleanText` and
  leaves `rawText` alone; that is the pattern. An AI step that replaces the user's
  own text needs an undo, and an undo that only lives in React state is gone on the
  next refresh.
- **`ReviewLog` never cascades.** Deleting a lecture must not erase the evidence that
  the student once knew it — every relation on the ledger is `SetNull` on purpose.

## Branch names

```
<type>/<short-kebab-description>
```

`<type>` is one of `feat`, `fix`, `refactor`, `chore`, `docs` — the same set the commit
and PR title use.

The description is lowercase, hyphen-separated, and names the change rather than the
files it touches. If a ticket ID exists, put it in the branch name so the PR title and
the Jira transition can both find it.

```
feat/course-library-materials
fix/task-polling-input-status
refactor/embedding-provider-chain
docs/phase-3-topics-spec
```

## PR titles

Derive the title from the branch name: keep the type, replace the first `/` with the
scope in parentheses.

```
<type>(<scope>): short imperative phrase
```

- `scope` is the subsystem that actually changed — not the branch slug repeated.
  Multiple scopes are comma-separated.
- The phrase is imperative, lowercase, no trailing period.
- Include a ticket ID only when one appears in the branch name or the commits.

```
feat/course-library-materials     → feat(courses, materials): upload and index course materials
fix/task-polling-input-status     → fix(review): re-enable grading after a rejected import
refactor/embedding-provider-chain → refactor(embeddings): collapse the provider chain
```

## PR descriptions

Use the CloudNation narrative format — invoke the `pr-create` skill, which is the source
of truth for it. The shape:

1. `## What this fixes` / `## What this adds` / `## What this changes`, then 2–4 sentences
   on how you found the problem and what it costs the user. Don't open with "This PR".
2. One `###` subsection per logical change, naming the file in the heading. Explain what
   was wrong in prose *before* showing code; number the failure points when a bug spans
   several of them; end with a `**Fix:**` bullet list.
3. `## Local dev setup` only when the steps aren't obvious from the README.
4. `## Verification` — what you actually ran, with real numbers. No "it works".

Write the description from the diff you observe, not from what you believe you did.
Narrative over bullet lists; a bug with three failure points gets three prose sentences.
A bug that threw no error and silently produced wrong data must say so explicitly —
that's what tells a reviewer why it was hard to catch.

```bash
gh pr create --base main --head "$(git branch --show-current)" \
  --title "<title>" --body-file <file>
```

This repo is on GitHub, so use `gh`. The `pr-review-loop` skill's `az repos pr` commands
are for the Azure DevOps repos and do not apply here.

## Commits

Same `<type>: <phrase>` convention, imperative and lowercase. Keep each commit to one
logical change so the PR's subsections have something to point at.

Never add a `Co-Authored-By` trailer to a commit whose content you did not write.
