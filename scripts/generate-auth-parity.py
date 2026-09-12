"""Generate synthetic expected findings from a local Python audit reference.

Usage: PYTHONPATH=/path/to/reference/src python generate-auth-parity.py OUTPUT.json
Requires the Python reference dependencies; never connects to Vault or reads credentials.
"""
import itertools
import json
import sys
import tempfile
from pathlib import Path

import yaml
from vault_security_audit.analysis.auth_rules import AUTH_DETECTORS
from vault_security_audit.analysis.base import AuditContext, RoleTarget
from vault_security_audit.config import load_config
from vault_security_audit.model import Assignment, Subject
from vault_security_audit.rules import RULES

cases = []
def case(name, auth_type, metadata, config=None):
    kind = {'approle':'approle','jwt':'jwt_role','oidc':'jwt_role','kubernetes':'kubernetes_role'}[auth_type]
    path = f'auth/{auth_type}/role/demo'
    raw = {'version':1, **(config or {})}
    with tempfile.TemporaryDirectory() as directory:
        file = Path(directory)/'config.yml';file.write_text(yaml.safe_dump(raw))
        settings = load_config(file)
    subject = Subject('',kind,path,'demo',f'auth/{auth_type}/',auth_type,metadata)
    policies = metadata.get('token_policies', [])
    if isinstance(policies,str): policies = policies.split(',')
    assignments = tuple(Assignment('',p,kind,path,'demo','assigned',path) for p in policies)
    target = RoleTarget(subject,assignments)
    context = AuditContext(settings,{}, {})
    expected=[]
    for detector in AUTH_DETECTORS.values():
        if kind not in RULES[detector.rule_id].affected_object_types: continue
        for f in detector.evaluate(target,context):
            expected.append({'ruleId':f.rule.rule_id,'severity':f.rule.severity,'evidence':f.evidence_data})
    cases.append({'name':name,'resource':{'kind':'role','path':path,'data':{'auth_type':auth_type,**metadata}},'config':raw,'expected':sorted(expected,key=lambda f:f['ruleId'])})

for i,(privileged,bind,uses,ttl) in enumerate(itertools.product([False,True],[False,True],[0,100,101],[0,86400,86401])):
    case(f'approle-controls-{i}','approle',{'token_policies':['root'] if privileged else ['reader'],'bind_secret_id':bind,'secret_id_num_uses':uses,'secret_id_ttl':ttl})
for i,(period,explicit,cidrs) in enumerate(itertools.product([0,'1h'],[0,'72h'],[[],['127.0.0.1/32']])):
    case(f'approle-period-{i}','approle',{'token_policies':['vault-admins'],'token_period':period,'token_explicit_max_ttl':explicit,'token_bound_cidrs':cidrs,'secret_id_bound_cidrs':cidrs,'bind_secret_id':False})
for i,(name,namespace,selector,privileged) in enumerate(itertools.product([['demo'],['*']],[['demo'],['*'],[]],[None,'{}','{"matchLabels":{"team":"demo"}}'],[False,True])):
    case(f'kubernetes-scope-{i}','kubernetes',{'token_policies':['root'] if privileged else ['reader'],'bound_service_account_names':name,'bound_service_account_namespaces':namespace,'bound_service_account_namespace_selector':selector})
case('approved-namespace','kubernetes',{'bound_service_account_names':['*'],'bound_service_account_namespaces':['approved']},{'kubernetes':{'allowed_wildcard_namespaces':['approved']}})
for auth_type in ['approle','jwt','kubernetes']:
    for ttl in [0,28800,28801,86400,86401,'1d1h']:
        case(f'{auth_type}-ttl-{ttl}',auth_type,{'token_ttl':ttl,'token_max_ttl':0})
    case(f'{auth_type}-custom-threshold',auth_type,{'token_ttl':3601,'token_max_ttl':14400},{'thresholds':{'token_ttl_warning':'1h','token_ttl_high':'4h'}})
for i,(role_type,privileged,claims) in enumerate(itertools.product(['jwt','oidc'],[False,True],[{}, {'ref_protected':'*','project':'demo'},{'project':'*'},{'project':['demo','*']},{'ref_protected':'*'}])):
    case(f'jwt-claims-{i}','jwt',{'role_type':role_type,'token_policies':['root'] if privileged else ['reader'],'bound_claims_type':'glob','bound_claims':claims})
case('jwt-required-claims','jwt',{'bound_claims':{'project':'demo'}},{'jwt':{'required_bound_claims_by_mount':{'jwt':['project','environment']}}})
case('jwt-bounded-subject','jwt',{'token_policies':['root'],'bound_subject':'service:demo','role_type':'jwt','bound_audiences':['vault']})
case('pattern-privilege','approle',{'token_policies':['team-a-admin']},{'privileged_policies':{'exact':[],'patterns':['team-[ab]-*']}})
case('configured-cidr-exemption','approle',{'token_policies':['root']},{'approle':{'require_cidr_for_privileged_roles':False}})
case('jwt-custom-boolean-glob','jwt',{'bound_claims_type':'glob','bound_claims':{'enabled':False}},{'jwt':{'broad_globs':['False']}})
case('jwt-normalized-mount-config','jwt',{'bound_claims':{}},{'jwt':{'required_bound_claims_by_mount':{'/jwt/':['project','environment']}}})
Path(sys.argv[1]).write_text(json.dumps(cases,ensure_ascii=False,separators=(',',':'))+'\n')
print(f'{len(cases)} auth fixtures generated; {sum(len(c["expected"]) for c in cases)} findings')
