# Copenhagen flat tracker

Four complementary Codex skills live in this repository:

- `$check-flat` updates the simple Markdown table in `flats.md`.
- `$check-flat-html` updates `dashboard/data/flats.json`, which powers the interactive local dashboard.
- `$sync-flat-dashboard` imports `flats.md` into the dashboard, preserves local reviews, and enriches new records.
- `$sync-dashboard-markdown` exports dashboard records back to `flats.md` without pruning either tracker.

The two check skills remain independently usable. Synchronization is explicit and directional:

- After `$check-flat`, invoke `$sync-flat-dashboard`.
- After `$check-flat-html`, invoke `$sync-dashboard-markdown`.

Both sync commands run as dry-runs first, retain records that exist only on the destination side, and refuse to write unresolved `Status` or `Note` conflicts.

This is a safe directional workflow, not an automatic two-way database merge. If the same ad-derived field is edited independently in both files, the direction you invoke is authoritative for that field. Manual `Status` and `Note` edits receive conflict detection because they are expected to change on either side.

## Run the dashboard

```powershell
npm run dashboard
```

Open <http://127.0.0.1:4173>. The server is local-only. Status and personal-note edits are saved back to the dashboard JSON file.
