# Data recovery runbook

How CourseMateAI's data is protected, and the drill to prove a restore works. Written for the data-loss pass (after
the BreakingBreach "Protect your app from data loss" checklist). Check Cloudflare's current docs before relying on
a limit quoted here; they change.

## What protects what

| Data | Where | Everyday undo | Disaster recovery |
| --- | --- | --- | --- |
| Accounts, progress, documents' text, courses, reviews | D1 (`DB`) | The Trash: a deleted PDF or course comes back for 30 days (Account -> Trash) | D1 Time Travel (point-in-time restore) + a weekly export kept outside Cloudflare |
| The PDFs themselves | R2 (`FILES`) | A trashed PDF keeps its file until it is deleted for good | R2 has no versioning: keep a copy of the bucket only if you need to (most students have the PDF) |
| Search vectors | Vectorize (`VECTORS`) | Kept with a trashed PDF | Rebuilt by uploading the PDF again |

The app's Worker can delete rows and files. Nothing it can reach can delete a Time Travel bookmark or a backup
stored on your own computer, which is the point of control 16.

## Who deleted what

Every move to the Trash, restore, deletion for good, expiry after 30 days and account deletion is a line in
`deletion_log` (kept a year; an account's line has no name or email):

```
npx wrangler d1 execute coursemateai --remote --command "SELECT at, user_id, actor_id, action, kind, item_name FROM deletion_log ORDER BY id DESC LIMIT 50"
```

A spike of `purged` or `trashed` lines from one user in a few minutes is worth a look.

## Before a risky change (a migration that drops or rewrites data)

1. Note the current Time Travel bookmark: `npx wrangler d1 time-travel info coursemateai`
2. Export: `npx wrangler d1 export coursemateai --remote --output backups/before-<change>.sql`
3. Run the migration on a copy first (below), then for real.

## Weekly backup (off Cloudflare)

```
npx wrangler d1 export coursemateai --remote --output backups/coursemateai-$(date +%F).sql
```

Keep the files on your own disk or a drive the app can't reach. They contain personal data: don't commit them
(`backups/` belongs in `.gitignore`), and delete old ones you no longer need.

## Restore from Time Travel (the live database)

Only after deciding the live data is wrong; everything written after the chosen moment is lost.

```
npx wrangler d1 time-travel restore coursemateai --timestamp=<ISO time before the incident>
```

The command prints a bookmark for the state it replaced: write it down, it is the way back if the restore was the
mistake.

## The restore drill (do it once now, then every few months)

1. Make a separate database: `npx wrangler d1 create coursemateai-restore-test`
2. Load the newest export into it:
   `npx wrangler d1 execute coursemateai-restore-test --remote --file backups/<newest>.sql`
3. Point a local copy at it: in `.dev.vars`, nothing changes; in a copy of `wrangler.jsonc`, set the `DB` binding's
   `database_name` / `database_id` to the test database, then `npm run preview` with that config.
4. Check the app works with the restored data (control 20):
   - sign in with your own account; your level, coins and streak are right
   - Study: your courses and PDFs are listed; a chat answers with citations
   - Review shows your due cards; Account -> Trash lists what was in it
   - the Admin page says "Local test copy"
5. Write down the date, how long it took, and anything that didn't work. Then delete the test database:
   `npx wrangler d1 delete coursemateai-restore-test`
