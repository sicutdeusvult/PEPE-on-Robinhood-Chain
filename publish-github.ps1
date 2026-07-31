param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryUrl
)

$ErrorActionPreference = "Stop"

if (Test-Path ".env") {
    Write-Host "[OK] Local .env found and will remain ignored." -ForegroundColor Green
}

npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

npm run check
if ($LASTEXITCODE -ne 0) { throw "Repository checks failed." }

if (-not (Test-Path ".git")) {
    git init
    if ($LASTEXITCODE -ne 0) { throw "git init failed." }
}

git branch -M main
git add .

$staged = git diff --cached --name-only
$forbidden = $staged | Where-Object {
    ($_ -eq ".env") -or
    (($_ -like ".env.*") -and ($_ -ne ".env.example")) -or
    ($_ -like "*.key") -or
    ($_ -like "*.pem") -or
    ($_ -like "*.keystore")
}

if ($forbidden) {
    git reset
    throw "Refusing to publish sensitive files: $($forbidden -join ', ')"
}

if (-not (git config user.name)) {
    throw "Set git user.name first: git config --global user.name 'Your Name'"
}
if (-not (git config user.email)) {
    throw "Set git user.email first: git config --global user.email 'you@example.com'"
}

git rev-parse --verify HEAD *> $null
$hasCommit = ($LASTEXITCODE -eq 0)

if (-not $hasCommit) {
    git commit -m "Initial PEPE Instant Launch repository"
    if ($LASTEXITCODE -ne 0) { throw "Initial git commit failed." }
} else {
    git diff --cached --quiet
    $hasNoStagedChanges = ($LASTEXITCODE -eq 0)
    if ($hasNoStagedChanges) {
        Write-Host "[OK] No new staged changes to commit." -ForegroundColor Green
    } else {
        git commit -m "Prepare PEPE Instant Launch repository"
        if ($LASTEXITCODE -ne 0) { throw "Git commit failed." }
    }
}

$origin = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) {
    git remote add origin $RepositoryUrl
} elseif ($origin -ne $RepositoryUrl) {
    git remote set-url origin $RepositoryUrl
}

git push -u origin main
if ($LASTEXITCODE -ne 0) { throw "Git push failed." }

Write-Host "[OK] Published to $RepositoryUrl" -ForegroundColor Green
