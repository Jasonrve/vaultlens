import { runGenerator, type Metadata, type Resource, type Scenario } from './parity-fixtures.js';

export function identityScenarios(): Scenario[] {
  const cases: Scenario[] = [];
  for (const parentField of [false, true]) for (const diamond of [false, true])
    for (const missing of [false, true]) {
      const data: Record<string, Metadata> = {
        top: { policies: ['admin'] }, left: { policies: ['left'] },
        right: { policies: ['right'] },
        leaf: { policies: ['read'], member_entity_ids: ['person'] },
      };
      const edges = [['left', 'top'], ['leaf', 'left']];
      if (diamond) edges.push(['right', 'top'], ['leaf', 'right']);
      if (missing) edges.push(['leaf', 'absent']);
      for (const [child, parent] of edges) {
        const target = parentField || !data[parent] ? data[child] : data[parent];
        const field = parentField || !data[parent] ? 'parent_group_ids' : 'member_group_ids';
        const ids = (target[field] ??= []) as string[];
        ids.push(parentField || !data[parent] ? parent : child);
      }
      const resources: Resource[] = Object.entries(data).map(([name, metadata]) => ({
        kind: 'group', path: `identity/group/id/${name}`, data: metadata,
      }));
      resources.push({ kind: 'entity', path: 'identity/entity/id/person', data: { policies: ['own'] } });
      cases.push({ name: `identity-${cases.length}`, resources });
    }
  return cases;
}

runGenerator(import.meta.url, 'identity', identityScenarios);
