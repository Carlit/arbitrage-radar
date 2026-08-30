Write-Host "=========================================" -ForegroundColor Magenta
Write-Host " Démarrage de l'environnement de Dev" -ForegroundColor Magenta
Write-Host "=========================================`n" -ForegroundColor Magenta

Write-Host "[1/5] Vérification de Docker..." -ForegroundColor Cyan
try {
    $dockerCheck = docker ps 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERREUR: Docker ne semble pas démarré ou accessible." -ForegroundColor Red
        Write-Host "Détails: $dockerCheck" -ForegroundColor Yellow
        Write-Host "Veuillez démarrer Docker Desktop et réessayer." -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker est en cours d'exécution." -ForegroundColor Green
} catch {
    Write-Host "ERREUR: Commande docker introuvable ou erreur d'exécution." -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/5] Démarrage de Supabase..." -ForegroundColor Cyan
npx supabase start

Write-Host "`n[3/5] Statut Supabase (clés et URLs) :" -ForegroundColor Cyan
npx supabase status

Write-Host "`n[4/5] Nettoyage des processus Node existants..." -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Processus Node nettoyés." -ForegroundColor Green

Write-Host "`n[5/5] Chargement des variables d'environnement (.env.supabase-poc)..." -ForegroundColor Cyan
if (Test-Path ".env.supabase-poc") {
    foreach ($line in Get-Content ".env.supabase-poc") {
        if (![string]::IsNullOrWhiteSpace($line) -and !$line.StartsWith("#")) {
            $parts = $line -split '=', 2
            if ($parts.Length -eq 2) {
                $name = $parts[0].Trim()
                $value = $parts[1].Trim()
                # Enlever les guillemets potentiels
                $value = $value -replace '^"|"$', ''
                $value = $value -replace "^'|'$", ''
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
    }
    Write-Host "Variables chargées dans la session courante." -ForegroundColor Green
} else {
    Write-Host "ATTENTION: Fichier .env.supabase-poc introuvable." -ForegroundColor Yellow
}

Write-Host "`n=> Lancement de l'application Next.js..." -ForegroundColor Magenta
Set-Location web
npm run dev
