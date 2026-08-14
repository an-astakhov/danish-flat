# Copenhagen flat tracker

Three complementary Codex skills live in this repository:

- `$check-flat` updates the simple Markdown table in `flats.md`.
- `$check-flat-html` updates `dashboard/data/flats.json`, which powers the interactive local dashboard.
- `$sync-flat-dashboard` imports `flats.md` into the dashboard, preserves local reviews, and enriches new records.

The two check skills remain independently usable. The sync skill is the explicit, one-way bridge from `flats.md` to the dashboard; it never writes back to Markdown.

The recommended two-step workflow is:

1. Add links quickly with `$check-flat`.
2. Invoke `$sync-flat-dashboard` when you want to refresh the interactive dashboard.

## Run the dashboard

```powershell
npm run dashboard
```

Open <http://127.0.0.1:4173>. The server is local-only. Status and personal-note edits are saved back to the dashboard JSON file.
