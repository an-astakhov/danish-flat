# Copenhagen flat tracker

Six complementary Codex skills live in this repository:

- `$check-flat` updates the simple Markdown table in `flats.md`.
- `$check-flat-html` updates `dashboard/data/flats.json`, which powers the interactive local dashboard.
- `$sync-flat-dashboard` imports `flats.md` into the dashboard, preserves local reviews, and enriches new records.
- `$sync-dashboard-markdown` exports dashboard records back to `flats.md` without pruning either tracker.
- `$search-flats` searches current listings using `flat-search-preferences.md`, rejects known ads from either tracker, adds strong new matches to the dashboard, and safely exports them to Markdown.
- `$replace-website` finds an exact copy of a paid-source ad on BoligZonen or another contactable site, then adds it or safely replaces the tracked source URL.

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

## Search for new flats

Edit `flat-search-preferences.md`, then invoke `$search-flats`. The search is AI-led and uses live portal pages rather than site-specific parsers. It derives its initial portal list from ads already stored in the trackers and defaults to adding up to five verified matches.

To inspect the current duplicate index and portal list without changing data:

```powershell
npm run flat-index
```

To look for a better source for a specific paid listing, invoke `$replace-website` with its URL. It changes nothing unless the alternative can be verified as the same physical unit.
