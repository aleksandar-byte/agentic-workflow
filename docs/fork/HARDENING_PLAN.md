# Codex Safe-Install Hardening Plan

> 🇪🇸 [Versión en español](HARDENING_PLAN.es.md)

## Status

Planned. Do not install skills from this fork until the acceptance gate below passes.

- Upstream: `gtrabanco/agentic-workflow`
- Audited baseline: `b535866633bbc4afbd75f013ad957d3068e64976`
- Intended environment: Codex on Windows
- Distribution boundary: selected skills only; no global install; no Pi package

## Goal

Create a small, reviewable Codex distribution that cannot silently widen the user's authorization, invoke high-impact workflows implicitly, or depend on files that the installer did not copy.

## Safety rules

1. Installation is project-scoped and allowlisted. Nothing is copied to the global Codex skills directory during development or testing.
2. A skill may inspect or plan within the user's request, but commits, pushes, pull-request changes, issue comments, labels, merges, workspace initialization, and other external mutations require explicit authorization for the named target.
3. State-changing and broad orchestration skills are explicit-only in Codex.
4. Full-auto merging and optional session hooks are disabled in the Codex distribution.
5. The Pi package and its dependency tree are excluded.
6. Every installed skill is self-contained: all referenced scripts and references ship inside its folder or through a versioned shared package that the installer verifies.
7. Upstream updates are reviewed and re-audited before they enter the hardened branch.

## Implementation phases

### P1 — Define the install allowlist and risk classes

- Inventory every skill and classify it as:
  - `R0`: read-only analysis or review.
  - `R1`: local file writes.
  - `R2`: git or external-system mutation.
- Start with a minimal `R0` pilot set. Add `R1` or `R2` skills only after their approval boundaries have tests.
- Produce a machine-readable install manifest containing the selected skill names, versions, and required resources.
- Fail closed on name collisions, missing resources, or an unexpected destination.

### P2 — Add Codex invocation controls

- Add `agents/openai.yaml` to each selected skill.
- Set `policy.allow_implicit_invocation: false` for all `R1`, `R2`, router, and generic orchestration skills.
- Keep names and descriptions narrow enough to avoid unrelated activation.
- Validate each selected skill with the native Codex skill validator.

### P3 — Enforce authorization boundaries

- Rewrite write-capable instructions so authorization for planning does not authorize execution.
- Before any mutation, require a preview naming the repository, branch, files, issue or pull request, external destination, and exact action.
- Add a stop point for commit, push, comment, label, merge, deletion, overwrite, or workspace scaffolding unless that exact action was requested.
- Disable `ship-roadmap --fullauto`, the transient merge wrapper, and automatic hook installation in the Codex build.
- Make dry-run or read-only behavior the default wherever practical.

### P4 — Make the selected skills self-contained and portable

- Package each required helper script with its calling skill, or provide one pinned shared runtime with an integrity manifest.
- Replace unresolved repository-root script paths.
- Use `os.tmpdir()`, normalize path separators, and remove privileged-symlink assumptions.
- Replace Unix-only commands with Node-based cross-platform equivalents or documented fallbacks.
- Keep the Codex distribution independent of the Pi package.

### P5 — Build the verification and release gate

- Test on Windows and Linux against the audited commit.
- Run secret-pattern, dependency-vulnerability, suspicious-execution, link, context-budget, and path-resolution checks.
- Install the allowlist into a disposable project and prove that no global directories or unrelated files change.
- Exercise realistic prompts for read-only, local-write, and external-write boundaries.
- Record the upstream commit, fork commit, manifest digest, test results, and approved skill list in a release receipt.

### P6 — Pilot and maintenance

- Pilot the hardened skills in one non-production repository.
- Review every proposed mutation during the pilot; do not enable automatic merging.
- Promote skills individually after successful behavior checks.
- Sync upstream through a dedicated branch, inspect the full diff, rerun the gate, and merge only reviewed changes.

## Acceptance gate

Installation is permitted only when all of these are true:

- Every selected skill and resource is named in the manifest.
- Every path referenced by an installed skill resolves after installation.
- All `R1`, `R2`, router, and orchestration skills are explicit-only.
- Mutation tests stop before acting without target-specific authorization.
- Full-auto merge and optional hooks are absent or disabled.
- Windows and Linux checks pass without privileged symlinks or hard-coded temporary paths.
- A disposable project-scoped installation changes only the expected destination.
- Security scans report no unresolved high-severity findings.
- The release receipt pins exact commits and hashes.

## Recommended first implementation unit

Implement P1 and P2 together for a small read-only pilot set. This establishes the install boundary and invocation policy before any high-impact workflow is adapted.
