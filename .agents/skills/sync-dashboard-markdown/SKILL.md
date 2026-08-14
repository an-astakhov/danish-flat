---
name: sync-dashboard-markdown
description: Synchronize dashboard/data/flats.json back into the repository's flats.md tracker without deleting Markdown-only rows or overwriting divergent user notes and statuses. Use when the user invokes $sync-dashboard-markdown, asks to export or reverse-sync the HTML dashboard to Markdown, or used $check-flat-html and wants flats.md updated. Run dry-first, append dashboard-only flats, preserve dashboard-only enrichment, and report conflicts.
---

# Sync the dashboard back to Markdown

Use `dashboard/data/flats.json` as the source for shared listing fields and `flats.md` as the destination tracker.

## Safety boundaries

- Never delete a Markdown row because it is absent from the dashboard.
- Never delete or reorder dashboard records.
- Update only `flats.md` plus `sync` metadata in `dashboard/data/flats.json`.
- Preserve dashboard photos, coordinates, titles, source metadata, status, and note values.
- Match records by canonical ad URL, ignoring obvious tracking parameters.
- Treat `Status` and `Note` as user-managed on both sides.

## Workflow

1. Run `node .agents/skills/sync-dashboard-markdown/scripts/sync.mjs` and review the dry-run summary.
2. If any conflict or duplicate canonical dashboard URL is reported, stop and ask the user to resolve it. Do not write either file.
3. Run the command with `--write` only when the dry run is conflict-free.
4. Update matching Markdown rows in place and append dashboard-only records after the existing table rows.
5. Preserve Markdown-only rows exactly as written.
6. For unknown dashboard values, retain an existing Markdown value instead of replacing it with an empty cell.
7. Update the JSON record's `sync` baseline only for manual fields that were successfully converged.
8. Report added, updated, unchanged, retained Markdown-only, and conflicted counts.

## Conflict policy

Compare each side's current `Status` and `Note` with the last Markdown values stored in the JSON record's `sync` object.

- Dashboard changed only: copy the dashboard value to Markdown.
- Markdown changed only: keep Markdown unchanged so a later `$sync-flat-dashboard` can import it.
- Both changed to the same value: accept the common value.
- Both changed differently: report a conflict and abort the write.
- No prior baseline: copy a non-empty value into an empty counterpart; if both sides contain different non-empty values, report a conflict.

## Recommended directions

- After `$check-flat`, run `$sync-flat-dashboard`.
- After `$check-flat-html`, run `$sync-dashboard-markdown`.
- Do not alternate directions to resolve a reported conflict. Choose the desired manual value first, then rerun the appropriate sync.
