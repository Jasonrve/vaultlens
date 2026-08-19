import { spawnSync } from 'node:child_process';

spawnSync('docker', ['rm', '-f', 'vaultlens-vault', 'vaultlens-vault-init'], {
  stdio: 'ignore',
});

const result = spawnSync(
  'docker-compose',
  ['-f', 'docker-compose-development.yml', 'up', '-d', 'vault', 'vault-init'],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);