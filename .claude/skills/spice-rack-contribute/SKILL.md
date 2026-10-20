---
name: spice-rack-contribute
description: Guidelines for contributing changes to the Spice Rack GitHub repository (spicelang/spice-rack) — branch naming conventions (enforced by a hook), commit message format, PR workflow, no-push-to-main rule, and quality gates. Use when preparing a branch for review, writing a commit, opening a PR, or checking that a contribution is ready to merge.
---

# Contribute to Spice Rack

This skill covers the full contribution workflow: naming branches, writing commits, opening a PR, and satisfying the
quality gates before merge. It follows the conventions of the main [Spice repository](https://github.com/spicelang/spice).

## Branch naming

All work happens on a dedicated branch, never directly on `main`. Never use auto-generated or `claude/...` branch names.

| Prefix | Use for |
|--------|---------|
| `feature/<slug>` | New pages, API endpoints, registry features |
| `fix/<slug>` (or `bug/<slug>`) | Bug fixes in the Spice logic, host, templates or styles |
| `chore/<slug>` | Dependency updates, deployment (Docker, nginx, compose), repo maintenance |
| `ci/<slug>` | GitHub Actions workflows and CI scripts |
| `test/<slug>` | New or updated unit or end-to-end tests |
| `docs/<slug>` | README, CONTRIBUTING and other documentation-only changes |
| `security/<slug>` | Security-sensitive fixes (prefer non-public disclosure first — see `SECURITY.md`) |

Rules:
- Use lowercase `kebab-case` slugs (`fix/package-page-overflow`, not `Fix/PackagePageOverflow`).
- Keep slugs short but descriptive; the squash-commit headline is taken from the PR title.
- Tie the slug to the issue number when one exists: `fix/42-package-page-overflow`.
- If the session starts on a pre-created branch, rename it with `git branch -m <type>/<slug>` before the first push.
- This is enforced by the `.claude/hooks/check-branch-name.py` hook, which blocks git commands that create, rename or
  push a branch with a non-conforming name.

```sh
git checkout main
git pull origin main
git checkout -b fix/package-page-overflow
```

## Commit message format

Use a short, descriptive headline — no type prefix or scope annotation:

```
<Short descriptive headline>

[optional body — explain WHY, not what]

[optional footer — Fixes #<issue>, Refs #<issue>, Co-authored-by: …]
```

Examples from this repository's history:

```
Add a copy button to code blocks in rendered markdown

Highlight Spice code blocks in READMEs and changelogs

Sign in again when GitHub rejects the session's token
```

Rules:
- Headline ≤ 72 characters, imperative mood ("Add", "Fix", not "Added", "Fixes").
- No trailing period on the headline.
- Blank line between headline and body.
- Reference issues in the footer with `Fixes #N` (auto-closes) or `Refs #N`.

## No-push-to-main rule

`main` only receives changes through pull requests. Never `git push origin main`; push the branch
(`git push -u origin <type>/<slug>`) and open a PR. If you accidentally committed to `main` locally, move the work to a
branch before pushing:

```sh
git checkout -b <type>/<slug>          # create branch at current HEAD
git checkout main
git reset --hard origin/main           # restore main to remote state
git checkout <type>/<slug>             # continue on the branch
```

## Repository rules

- Schema changes go into a new numbered file in `db/migrations/`. Never edit a migration that was already released.
- Package names are lower kebab-case; the rule lives only in `isValidPackageName` / `packageNameRule` (`src/util.spice`).
- The JSON API is consumed by Spice Shaker: add fields instead of renaming or removing them.
- Release images are published by pushing a `v*` tag (`.github/workflows/release.yml`); pushes to `main` publish the
  `staging` image. Leave tagging to the maintainers.

## Pre-PR quality gate

Run the same checks as CI (details in the `spice-rack-build-test` skill):

```sh
"$SPICE" test src/tests.spice                         # 1. Spice unit tests
scripts/build-wasm.sh                                 # 2. wasm build
(cd host && npm ci && npm run lint)                   # 3. ESLint + Stylelint
(cd host && E2E_DB_PORT=3307 E2E_DB_NAME=rack_test npm test)   # 4. template check + e2e tests
```

If the environment cannot run a check, say so explicitly in the PR description. Do not silently skip checks.

## Opening the pull request

Target branch: **`main`**. The PR title uses the same style as commit headlines: short, descriptive, imperative mood,
no type prefix.

PR description template:

```markdown
## What changed
<!-- 1-3 bullets describing the change -->

## Why
<!-- Motivation, linked issue, or design rationale -->

## How it was validated
<!-- Exact commands run + outcome, e.g.: -->
- `spice test src/tests.spice` — all pass
- `scripts/build-wasm.sh` — builds
- `cd host && npm run lint && E2E_DB_NAME=rack_test npm test` — all pass

## Follow-up / known limitations
<!-- Anything deferred, or limitations the reviewer should know -->

Fixes #<issue>
```

Additional rules:
- Keep PRs focused — one logical change per PR.
- Add or extend an e2e test in `host/test/e2e.test.mjs` for changed request handling, and `#[test]` functions for
  changed pure logic.
- Update the README if routes, the API, configuration, template syntax or user-visible behavior change.
- Do not force-push a branch that already has a PR open (use a new commit instead) unless a reviewer explicitly asks
  for a rebase.

## Merge strategy

PRs are merged by a maintainer using **squash and merge** — every PR lands as a single commit on `main` with the PR
title as headline. Write clean incremental commits on your branch so the reviewer can follow the progression.

## Checklist

- [ ] Branch named `<type>/<slug>` with an allowed type and a descriptive slug
- [ ] All commits have a short descriptive headline (no type prefix)
- [ ] Spice unit tests pass (`spice test src/tests.spice`)
- [ ] wasm module builds (`scripts/build-wasm.sh`)
- [ ] Lint passes (`cd host && npm run lint`)
- [ ] Host tests pass, including e2e against a `_test` database
- [ ] New migration instead of an edited one, if the schema changed
- [ ] README updated if behavior/API/configuration changed
- [ ] Issue linked in footer (`Fixes #N` or `Refs #N`)
- [ ] PR targets `main`
