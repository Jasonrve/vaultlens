import assert from 'node:assert/strict';
import { flattenConfig } from '../src/client/lib/config-import/flattenConfig';
import { importConfig } from '../src/client/lib/config-import';

assert.deepEqual(flattenConfig({
  ConnectionStrings: { Default: 'Server=db' },
  Servers: [{ Host: 'one' }, { Host: 'two' }],
  Enabled: true,
  Empty: null,
}), {
  ConnectionStrings__Default: 'Server=db',
  Servers__0__Host: 'one',
  Servers__1__Host: 'two',
  Enabled: 'true',
  Empty: '',
});

assert.equal(importConfig('{"App":{"Port":8080}}', 'appsettings.json').data.App__Port, '8080');
assert.equal(importConfig('APP_NAME=vaultlens\nDEBUG=false', '.env.production').data.APP_NAME, 'vaultlens');
assert.equal(importConfig('App:\n  Name: vaultlens', 'application.yaml').data.App__Name, 'vaultlens');
assert.equal(importConfig('[database]\nhost=db01', 'config.ini').data.database__host, 'db01');
assert.equal(importConfig('[database]\nhost = "db01"', 'config.toml').data.database__host, 'db01');
assert.equal(importConfig('app.name = VaultLens', 'application.properties').data['app.name'], 'VaultLens');
const pastedIni = importConfig('[RESTAPI]\naddaccounturl=[http://example.test/add](http://example.test/add)\npassword=secret', 'pasted.config');
assert.equal(pastedIni.format, 'ini');
assert.equal(pastedIni.data.RESTAPI__addaccounturl, 'http://example.test/add');
assert.equal(pastedIni.data.RESTAPI__password, 'secret');
const withoutParent = importConfig('[RESTAPI]\nusername=svc-user', 'pasted.config', 'ini', false);
assert.equal(withoutParent.data.username, 'svc-user');

assert.throws(() => importConfig('not valid', 'config.json'), /Could not parse/);
assert.throws(() => importConfig('plain text with no configuration structure', 'config.txt'), /Could not parse/);
console.log('Config import checks passed');