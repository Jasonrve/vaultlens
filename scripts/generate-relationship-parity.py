"""Synthetic relationship oracle. Requires local Python reference on PYTHONPATH.
Usage: python generate-relationship-parity.py OUTPUT.json
Does not connect to Vault or read credentials.
"""
import itertools, json, sys, hashlib
from pathlib import Path
from vault_security_audit.analysis.base import AuditContext, RoleTarget
from vault_security_audit.analysis.parser import parse_policy
from vault_security_audit.analysis.relationship_rules import RELATIONSHIP_DETECTORS
from vault_security_audit.config import AuditConfig
from vault_security_audit.model import Assignment, Subject

output=[]
selected=['escalation_graph','self_policy_escalation','token_role_escalation','auth_mount_bootstrap','policy_role_assignment_chain']
for index,(caps,include_default,allowed) in enumerate(itertools.product(
    [['update'],['read'],['deny','update'],['create','update']], [False,True],
    [[],['reader'],['root'],['vault-admins']])):
    path='auth/approle/role/demo'
    token_path='auth/token/roles/issuer'
    def role(kind,path,auth,metadata,refs):
        return RoleTarget(Subject('',kind,path,path.split('/')[-1],f'auth/{auth}/',auth,metadata),
          tuple(Assignment('',p,kind,path,path.split('/')[-1],relationship,path) for p,relationship in refs))
    metadata={'token_policies':['source'], 'token_no_default_policy':not include_default}
    target=role('approle',path,'approle',metadata,[('source','assigned')]+([('default','implicit_default')] if include_default else []))
    token_data={'allowed_policies':allowed,'allowed_policies_glob':['team-*']}
    token=role('token_role',token_path,'token',token_data,[(p,'allowed') for p in allowed]+[('team-*','allowed_glob')])
    policies={
      'source':'\n'.join('path '+json.dumps(p)+' { capabilities = '+json.dumps(caps)+' }' for p in [path,token_path,'sys/auth/*','sys/policies/acl/source']),
      'default':'\n'.join('path '+json.dumps(p)+' { capabilities = ["update"] }' for p in ['auth/token/create/issuer','sys/policies/acl/*','auth/+/config']),
    }
    context=AuditContext(AuditConfig(),{}, {('',name):parse_policy(hcl) for name,hcl in policies.items()}, token_role_targets=(token,))
    expected=[]
    for detector in selected:
        for f in RELATIONSHIP_DETECTORS[detector].evaluate(target,context):
            expected.append({'ruleId':f.rule.rule_id,'severity':f.rule.severity,'evidence':f.evidence_data})
    output.append({'name':f'relationship-{index}', 'resources':[
      *[{'kind':'policy','path':f'sys/policies/acl/{name}','data':{'name':name,'hcl':hcl}} for name,hcl in policies.items()],
      {'kind':'role','path':path,'data':{'auth_type':'approle',**metadata}},
      {'kind':'role','path':token_path,'data':{'auth_type':'token',**token_data}},
    ],'path':path,'expected':sorted(expected,key=lambda f:f['ruleId'])})
for shared, privileged, can_write in itertools.product([False,True], repeat=3):
    source_path='auth/approle/role/source'
    target_path='auth/approle/role/target'
    source=role('approle',source_path,'approle',{},[('source','assigned')])
    target=role('approle',target_path,'approle',{},[('root' if privileged else 'reader','assigned')])
    hcl='path "'+target_path+'" { capabilities = '+json.dumps(['update'] if can_write else ['read'])+' }'
    entities={('',source_path):frozenset(['entity-a']),('',target_path):frozenset(['entity-a' if shared else 'entity-b'])}
    context=AuditContext(AuditConfig(),{}, {('','source'):parse_policy(hcl)},
        privileged_role_targets=((target,{'root':['configured_privileged_policy']}),) if privileged else (),
        role_entity_ids=entities)
    expected=[{'ruleId':f.rule.rule_id,'severity':f.rule.severity,'evidence':f.evidence_data}
        for f in RELATIONSHIP_DETECTORS['privileged_role_mutation'].evaluate(source,context)]
    resources=[{'kind':'policy','path':'sys/policies/acl/source','data':{'name':'source','hcl':hcl}},
        {'kind':'auth-mount','path':'auth/approle/','data':{'type':'approle','accessor':'test-accessor'}}]
    for name,path,policies,entity in [('source',source_path,['source'],'entity-a'),('target',target_path,['root' if privileged else 'reader'],'entity-a' if shared else 'entity-b')]:
        digest=hashlib.sha256(name.encode()).hexdigest()
        resources.extend([
          {'kind':'role','path':path,'data':{'auth_type':'approle','token_policies':policies,'token_no_default_policy':True,'role_id_sha256':digest}},
          {'kind':'alias','path':'identity/entity-alias/id/'+name,'data':{'canonical_id':entity,'mount_accessor':'test-accessor','name_sha256':digest}},
        ])
    output.append({'name':f'cross-role-{shared}-{privileged}-{can_write}','resources':resources,'path':source_path,'expected':expected})
Path(sys.argv[1]).write_text(json.dumps(output,separators=(',',':'))+'\n')
print(f'{len(output)} relationship fixtures; {sum(len(c["expected"]) for c in output)} findings')
