<#
.SYNOPSIS
  Back up CourseMate's data: the database (a consistent copy, safe while running) and the uploaded PDFs.

.DESCRIPTION
  Writes backups\coursemate-<date>.db (SQLite's own backup API, so it is consistent even mid-write) and
  backups\uploads-<date>.zip (the kept PDFs; the search indexes are rebuilt from them, so they are left out).
  Keeps the newest -Keep of each. -Schedule registers a daily Windows scheduled task at 03:15 that runs this.
  On PostgreSQL (DATABASE_URL), use pg_dump instead (docs/postgres.md).

.EXAMPLE
  .\deploy\windows\backup.ps1
  .\deploy\windows\backup.ps1 -Schedule
#>
param([int]$Keep = 14, [switch]$Schedule)
. "$PSScriptRoot\common.ps1"

if ($Schedule) {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Keep $Keep"
    $trigger = New-ScheduledTaskTrigger -Daily -At "03:15"
    Register-ScheduledTask -TaskName "CourseMate backup" -Action $action -Trigger $trigger -Description "Daily CourseMate backup" -Force | Out-Null
    Ok "scheduled: 'CourseMate backup' every day at 03:15 (Task Scheduler)"
    exit 0
}

if (Get-EnvValue "DATABASE_URL") { Fail "This server uses PostgreSQL: back it up with pg_dump (docs/postgres.md)." }
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$db = Join-Path $Backend "data\coursemate.db"
if (-not (Test-Path $db)) { Fail "No database at backend\data\coursemate.db" }

Step "Database"
$target = Join-Path $BackupDir "coursemate-$stamp.db"
& $VenvPy -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" $db $target
if ($LASTEXITCODE -ne 0) { Fail "The database backup failed." }
Ok "backups\coursemate-$stamp.db"

Step "Uploaded PDFs"
$files = Join-Path $Backend "uploads\files"
if (Test-Path $files) {
    Compress-Archive -Path (Join-Path $files "*") -DestinationPath (Join-Path $BackupDir "uploads-$stamp.zip") -Force
    Ok "backups\uploads-$stamp.zip"
} else { Say "no kept PDFs yet" }

foreach ($pattern in @("coursemate-*.db", "uploads-*.zip")) {
    Get-ChildItem $BackupDir -Filter $pattern | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item -Force
}
Say "Keep a copy of backend\.env somewhere safe too: without ENCRYPTION_KEY the saved API keys can't be read."
