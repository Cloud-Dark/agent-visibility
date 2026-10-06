# Documentation Standard
> Status: Final
> Last updated: 2026-10-06

Rules for docs layout, headers, language, links, and changelog updates.

## Checklist

- [ ] File lives in the right docs folder with the right number
- [ ] Header block matches the required format
- [ ] Written in English, professional tone, no persona
- [ ] Cross links use relative paths and are verified
- [ ] Changelog updated for user facing changes

## Layout

```text
docs/
  standards/
    00_STANDARD_INDEX.md
    01_CONTRIBUTION_STANDARD.md
    02_CODE_STANDARD.md
    04_SECURITY_STANDARD.md
    05_TESTING_STANDARD.md
    06_DOCUMENTATION_STANDARD.md
  CHANGELOG.md
```

- Standards live in `docs/standards/`.
- Numbering: `00` index, then `01`, `02`, and so on. Keep existing numbers stable even if a slot is empty (there is no `03` yet).
- One topic per file, short and practical, checklist style where it fits.

## Header format

Every standards file starts with exactly:

```text
# Title
> Status: Final
> Last updated: 2026-10-06
```

- Line 1 is an H1 title.
- Status is `Draft` while in review, then `Final`.
- Date format is `YYYY-MM-DD`.

## Language and style

- English only.
- Professional tone, no persona, no jokes.
- No em dashes anywhere in docs. Use commas, colons, or hyphens instead.
- Short sections, code blocks with language tags, tables for reference data.

## Cross links

- Link standards from `00_STANDARD_INDEX.md`.
- Use relative paths: `./01_CONTRIBUTION_STANDARD.md`, `../../README.md`.
- Verify every link after moving or renaming a file.
- Reference `hooks.json` and `README.md` by path when behavior is described.

## Changelog

- Update `docs/CHANGELOG.md` for every user facing change.
- Entry format: version, date, then Added / Fixed / Changed bullets.
- Docs only changes do not need a changelog entry.
