# Contribution Standard
> Status: Final
> Last updated: 2026-10-06

Branch, commit, and PR flow for this GitHub repo.

## Checklist

- [ ] Create a short lived branch from `main` for each change
- [ ] Use the commit message format below
- [ ] Open a PR into `main` and request one review
- [ ] Keep PRs small and focused on one change
- [ ] Update docs and changelog when behavior changes

## Branches

- `main` is always releasable.
- Branch naming: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
- Example: `feat/sse-heartbeat`, `fix/port-fallback`, `docs/testing-standard`.
- Delete the branch after merge.

## Commit messages

Format:

```text
<type>: <short summary>
```

- Types: `feat`, `fix`, `docs`, `chore`, `refactor`.
- Keep the summary under 72 chars, imperative mood.
- Example: `fix: reuse healthy server instead of restarting`.
- End every commit message with this line:

```text
Co-Authored-By: Claude Code <noreply@anthropic.com>
```

## PR flow

1. Push the branch to GitHub.
2. Open a PR with a clear title and a short description (what changed, why, how tested).
3. Link any related issue.
4. Wait for one approval, then squash and merge.
5. End the PR description with:

```text
Generated with [Claude Code](https://claude.com/claude-code)
```

## Notes

- No direct pushes to `main`.
- No build step and no test framework in this repo, so describe manual test results in the PR.
