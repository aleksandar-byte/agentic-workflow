# Codex safe distribution

> 🇪🇸 [Versión en español](README.es.md)

This directory is a fork-specific, project-scoped distribution for Codex. It is deliberately separate from the upstream `skills/` tree and installs only to the officially supported repository location `<project>/.agents/skills`.

## Safety boundary

- Do **not** run `npx skills add .` from the repository root; that exposes the complete upstream workflow.
- Only the eight R0 findings-only skills in `release-manifest.json` are eligible for installation.
- Every included skill is namespaced with `agentic-` and has `policy.allow_implicit_invocation: false`.
- The installer refuses global destinations, collisions, overwrites, symlinks, tampered files, and an existing receipt.
- Installation defaults to dry-run and requires an explicit `--apply` flag.
- `--apply` requires a clean checkout whose `HEAD` carries the pinned `codex-safe-v0.1.0` release tag.
- The Pi package, hooks, workspace scaffold, mutable verification, commits, pushes, comments, labels, and merges are excluded.

## Commands

Build and validate the distribution:

```text
node scripts/build-codex-safe.mjs
node --test scripts/codex-safe.test.mjs
```

Preview a future project-scoped installation without changing anything:

```text
node scripts/install-codex-safe.mjs --project <absolute-project-path> --dry-run
```

`--apply` must not be used until the hardening pull request is reviewed, all acceptance checks pass, and the user explicitly approves the named project destination.

## Included skills

- `agentic-review-a11y`
- `agentic-review-brand`
- `agentic-review-code`
- `agentic-review-debt`
- `agentic-review-design`
- `agentic-review-implementation`
- `agentic-review-security`
- `agentic-review-seo`

The complete inclusion and exclusion rationale is in `manifest.json`.

Repository-local skill discovery and explicit-only invocation follow the [official OpenAI Codex skills documentation](https://learn.chatgpt.com/docs/build-skills).
