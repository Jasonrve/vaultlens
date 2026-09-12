import { AUDIT_HELP } from './cliHelp.js';
import { reportArchive } from './reportArchive.js';
import { writeReportDirectory } from './reportDirectory.js';
import { mergeRefresh } from './refresh.js';
import { parseCollectionOptions } from './requestPolicy.js';
import { prepareResume } from './resume.js';
import { importPythonSnapshot } from './pythonImport.js';
import { withoutPolicySource } from './sourceRedaction.js';
import { snapshotNamespaces, normalizeNamespace } from './namespaces.js';
import { exportAudit } from './exporter.js';
import { parseAuditArguments, auditExitCode } from './cliOptions.js';
import { parseExceptions } from './exceptions.js';
import { createBaseline, parseBaseline, applyBaseline } from './baseline.js';
import { compareRuns } from './diff.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { catalog } from './catalog.js';
import { AuditStore } from './store.js';
import { collect } from './collector.js';
import { execute } from './engine.js';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['help', '--help', '-h'].includes(args[0])) {
    console.log(AUDIT_HELP);
    return;
  }
  const options = parseAuditArguments(args);
  const target = process.env['VAULT_ADDR'] || 'http://127.0.0.1:8200';
  const store = new AuditStore(
    process.env['VAULTLENS_AUDIT_DB'] || 'data/security-audit.sqlite',
  );
  try {
    const {
      command,
      positionals: [argument, second],
    } = options;
    if (
      ['scan', 'collect'].includes(command) &&
      !process.argv.includes('--namespace')
    )
      options.requestPolicy.namespace = normalizeNamespace(
        process.env['VAULT_NAMESPACE'] ?? '',
      );
    const baseline = options.baseline
      ? parseBaseline(readFileSync(options.baseline, 'utf8'))
      : undefined;
    const exceptionSource = options.exceptions
      ? readFileSync(options.exceptions, 'utf8')
      : undefined;
    const exceptionSettings =
      command === 'analyze' && argument && !options.currentRules
        ? (store.get(argument, target)?.configuration ?? store.settings())
        : store.settings();
    const exceptions =
      exceptionSource !== undefined
        ? parseExceptions(
            exceptionSource,
            new Set(
              (
                exceptionSettings as import('../../shared/auditRules.js').RunConfiguration
              ).catalog?.map((r) => r.id) ??
                catalog(exceptionSettings).map((r) => r.id),
            ),
          )
        : [];
    if (command === 'export-archive' && argument && second) {
      const detail = store.get(argument, target);
      if (!detail) throw new Error('Snapshot not found for VAULT_ADDR');
      writeFileSync(second, reportArchive(detail, options.redactPolicySource), {
        mode: 0o600,
        flag: 'wx',
      });
      console.log(JSON.stringify({ archive: second }));
    } else if (command === 'export-directory' && argument && second) {
      const detail = store.get(argument, target);
      if (!detail) throw new Error('Snapshot not found for VAULT_ADDR');
      console.log(
        JSON.stringify({
          directory: second,
          files: writeReportDirectory(
            detail,
            second,
            options.redactPolicySource,
          ),
        }),
      );
    } else if (command === 'import-python' && argument) {
      const snapshot = importPythonSnapshot(argument, target);
      const id = store.create(target);
      try {
        store.finish(id, snapshot, []);
      } catch (error) {
        store.fail(id);
        throw error;
      }
      console.log(
        JSON.stringify({
          id,
          analysisPerformed: false,
          resources: snapshot.resources.length,
          issues: snapshot.issues.length,
        }),
      );
    } else if (command === 'export' && argument && second) {
      const detail = store.get(argument, target);
      if (!detail) throw new Error('Snapshot not found for VAULT_ADDR');
      writeFileSync(
        second,
        exportAudit(detail, options.format, options.redactPolicySource),
        { mode: 0o600, flag: 'wx' },
      );
      console.log(
        JSON.stringify({
          export: second,
          format: options.format,
          runId: argument,
        }),
      );
    } else if (command === 'baseline-create' && argument && second) {
      const detail = store.get(argument, target);
      if (!detail) throw new Error('Snapshot not found for VAULT_ADDR');
      writeFileSync(
        second,
        JSON.stringify(createBaseline(detail), null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      console.log(JSON.stringify({ baseline: second, sourceRunId: argument }));
    } else if (command === 'collect') {
      if (!process.env['VAULT_TOKEN'])
        throw new Error('VAULT_TOKEN is required');
      const id = store.create(target);
      try {
        const snapshot = await collect(
          target,
          process.env['VAULT_TOKEN'],
          false,
          options.requestPolicy,
          undefined,
          (snapshot) => store.saveCheckpoint(id, snapshot),
        );
        store.finish(id, snapshot, []);
        console.log(
          JSON.stringify(
            {
              id,
              snapshot: options.redactPolicySource
                ? withoutPolicySource(snapshot)
                : snapshot,
              analysisPerformed: false,
            },
            null,
            2,
          ),
        );
        process.exitCode =
          snapshot.issues.length && options.requireComplete ? 2 : 0;
      } catch (error) {
        store.fail(id);
        throw error;
      }
    } else if (
      command === 'scan' ||
      command === 'resume' ||
      command === 'refresh'
    ) {
      if (!process.env['VAULT_TOKEN'])
        throw new Error('VAULT_TOKEN is required');
      const source = ['resume', 'refresh'].includes(command)
        ? store.get(argument, target)
        : null;
      if (
        command === 'resume' &&
        (!source?.snapshot ||
          !['interrupted', 'failed'].includes(source.run.status))
      )
        throw new Error('Resume requires a failed or interrupted checkpoint');
      if (
        command === 'refresh' &&
        (!source?.snapshot?.collection ||
          !['collected', 'completed', 'partial'].includes(source.run.status))
      )
        throw new Error(
          'Refresh requires a finished native collection snapshot',
        );
      const resume =
        command === 'resume' && source?.snapshot
          ? { snapshot: source.snapshot, maxAgeMs: options.checkpointMaxAgeMs }
          : undefined;
      const requestPolicy = resume
        ? prepareResume(resume.snapshot, target, resume.maxAgeMs).options
        : command === 'refresh'
          ? parseCollectionOptions({
              ...source!.snapshot!.collection!.requestPolicy,
              sources: options.requestPolicy.sources,
            })
          : options.requestPolicy;
      const id = store.create(target);
      try {
        let snapshot = await collect(
          target,
          process.env['VAULT_TOKEN'],
          false,
          requestPolicy,
          undefined,
          (snapshot) => store.saveCheckpoint(id, snapshot),
          resume,
        );
        if (command === 'refresh')
          snapshot = mergeRefresh(
            source!.snapshot!,
            snapshot,
            requestPolicy.sources,
          );
        if (source) snapshot.sourceRunId = source.run.id;
        const { findings, configuration, identity } = execute(
          snapshot,
          store.settings(),
        );
        const controls = applyBaseline(
          findings,
          configuration,
          target,
          baseline,
          exceptions,
          undefined,
          snapshotNamespaces(snapshot),
        );
        snapshot.controls = controls;
        snapshot.analysisPerformed = true;
        snapshot.identity = identity;
        store.finish(id, snapshot, findings, configuration);
        console.log(
          JSON.stringify(
            {
              id,
              snapshot: requestPolicy.redactPolicySource
                ? withoutPolicySource(snapshot)
                : snapshot,
              findings,
              configuration,
              controls,
            },
            null,
            2,
          ),
        );
        process.exitCode = auditExitCode(
          findings
            .filter((_, i) => controls.states[i].gate)
            .map((f) => f.severity),
          !!(snapshot.issues.length || configuration.issues.length),
          options,
        );
      } catch {
        store.fail(id);
        throw new Error('Collection failed');
      }
    } else if (command === 'diff' && argument && second) {
      const old = store.get(argument, target),
        next = store.get(second, target);
      if (!old || !next) throw new Error('Both runs must exist for VAULT_ADDR');
      const result = compareRuns(old, next);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = auditExitCode(
        result.changes.findings.flatMap((change) =>
          ['added', 'changed'].includes(change.change) && change.new
            ? [change.new.severity]
            : [],
        ),
        !!result.warnings.length,
        options,
      );
    } else if (command === 'analyze' && argument) {
      const detail = store.get(argument, target);
      if (!detail?.snapshot)
        throw new Error('Snapshot not found for VAULT_ADDR');
      if (
        !detail.snapshot.finishedAt ||
        !['collected', 'completed', 'partial'].includes(detail.run.status)
      )
        throw new Error(
          'Analysis requires a finished snapshot; the saved checkpoint is incomplete',
        );
      const { findings, configuration, identity } = execute(
        detail.snapshot,
        options.currentRules
          ? store.settings()
          : (detail.configuration ?? store.settings()),
      );
      const controls = applyBaseline(
        findings,
        configuration,
        target,
        baseline,
        exceptions,
        undefined,
        snapshotNamespaces(detail.snapshot),
      );
      let resultId = argument;
      if (options.save) {
        const snapshot = {
          ...detail.snapshot,
          identity,
          controls,
          analysisPerformed: true,
          sourceRunId: argument,
        };
        resultId = store.create(target);
        try {
          store.finish(resultId, snapshot, findings, configuration);
        } catch (error) {
          store.fail(resultId);
          throw error;
        }
      }
      console.log(
        JSON.stringify(
          {
            id: resultId,
            sourceRunId: argument,
            controls,
            identity,
            findings,
            issues: detail.snapshot.issues,
            configuration,
          },
          null,
          2,
        ),
      );
      process.exitCode = auditExitCode(
        findings
          .filter((_, i) => controls.states[i].gate)
          .map((f) => f.severity),
        !!(detail.snapshot.issues.length || configuration.issues.length),
        options,
      );
    } else if (command === 'rules')
      console.log(JSON.stringify(catalog(store.settings()), null, 2));
    else if (command === 'configure' && argument) {
      const current = store.settings();
      const next = store.saveSettings({
        ...current,
        configYaml: readFileSync(argument, 'utf8'),
        customRulesYaml: second
          ? readFileSync(second, 'utf8')
          : current.customRulesYaml,
      });
      console.log(JSON.stringify(next, null, 2));
    } else if (command === 'list')
      console.log(JSON.stringify(store.list(target), null, 2));
    else throw new Error(AUDIT_HELP);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Audit failed');
    process.exitCode = 2;
  } finally {
    store.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Audit failed');
  process.exitCode = 2;
});
