$ErrorActionPreference = 'Stop'

rdctl shell true 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Rancher Desktop backend is not ready; restarting it...'
  rdctl shutdown
  rdctl start --container-engine.name=moby
}

docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Rancher Desktop is running but its Moby Docker engine is unavailable. Open Rancher Desktop and wait for the engine to become ready.'
  exit 1
}
