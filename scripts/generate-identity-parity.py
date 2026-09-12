"""Generate synthetic acyclic Identity inheritance fixtures from Python; no Vault access."""
import itertools,json,sys
from datetime import datetime,timezone
from pathlib import Path
from vault_security_audit.analysis.identity import correlate_identity
from vault_security_audit.model import ScanSnapshot,Subject,Assignment
output=[]
for index,(parent_field,diamond,missing) in enumerate(itertools.product([False,True],repeat=3)):
    data={
      'top':{'policies':['admin']},'left':{'policies':['left']},
      'right':{'policies':['right']},'leaf':{'policies':['read'],'member_entity_ids':['person']},
    }
    edges=[('left','top'),('leaf','left')]+([('right','top'),('leaf','right')] if diamond else [])
    if missing: edges.append(('leaf','absent'))
    for child,parent in edges:
        if parent_field or parent not in data: data[child].setdefault('parent_group_ids',[]).append(parent)
        else: data[parent].setdefault('member_group_ids',[]).append(child)
    subjects=[Subject('','identity_group',name,name,metadata=meta) for name,meta in data.items()]
    subjects.append(Subject('','identity_entity','person','person',metadata={'policies':['own']}))
    snapshot=ScanSnapshot('fixture',datetime.now(timezone.utc),'http://example.invalid',subjects=subjects)
    for subject in subjects:
        for policy in subject.metadata['policies']:
            path=f'identity/{"group" if subject.kind=="identity_group" else "entity"}/id/{subject.subject_id}'
            snapshot.assignments.append(Assignment('',policy,subject.kind,subject.subject_id,subject.name,'assigned',path))
    correlate_identity(snapshot)
    expected=[]
    for a in snapshot.assignments:
        kind='group' if a.subject_kind=='identity_group' else 'entity'
        expected.append({'subjectPath':f'identity/{kind}/id/{a.subject_id}','subjectKind':kind,
          'policy':a.policy_name,'relationship':a.relationship,'sourcePath':a.source_path})
    resources=[{'kind':'group' if s.kind=='identity_group' else 'entity',
      'path':f'identity/{"group" if s.kind=="identity_group" else "entity"}/id/{s.subject_id}','data':dict(s.metadata)} for s in subjects]
    output.append({'name':f'identity-{index}','resources':resources,'expected':expected,'partial':bool(snapshot.warnings)})
Path(sys.argv[1]).write_text(json.dumps(output,separators=(',',':'))+'\n')
print(f'{len(output)} Identity fixtures')
