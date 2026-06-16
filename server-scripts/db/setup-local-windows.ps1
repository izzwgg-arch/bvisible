# Bootstrap local Postgres on Windows for B Visible dev.
param(
  [string]$SuperUser = 'postgres',
  [string]$SuperPassword = 'postgres',
  [string]$AppUser = 'bvisible',
  [string]$AppPassword = 'bvisible_local_dev',
  [string]$AppDb = 'bvisible'
)

$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\16\bin\psql.exe'
if (-not (Test-Path $psql)) {
  throw "psql not found at $psql. Install PostgreSQL 16 or adjust the path."
}

$env:PGPASSWORD = $SuperPassword
$roleSql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$AppUser') THEN
    CREATE ROLE $AppUser LOGIN PASSWORD '$AppPassword';
  ELSE
    ALTER ROLE $AppUser WITH LOGIN PASSWORD '$AppPassword';
  END IF;
END `$`$;
"@
& $psql -U $SuperUser -h 127.0.0.1 -d postgres -w -v ON_ERROR_STOP=1 -c $roleSql | Out-Null

$dbExists = & $psql -U $SuperUser -h 127.0.0.1 -d postgres -w -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$AppDb';"
if ($dbExists.Trim() -ne '1') {
  & $psql -U $SuperUser -h 127.0.0.1 -d postgres -w -v ON_ERROR_STOP=1 -c "CREATE DATABASE $AppDb OWNER $AppUser;" | Out-Null
}

$env:PGPASSWORD = $AppPassword
& $psql -U $AppUser -h 127.0.0.1 -d $AppDb -w -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' | Out-Null

Write-Host "OK - local database $AppDb ready for user $AppUser"
