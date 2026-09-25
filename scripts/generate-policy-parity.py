"""Generate synthetic policy/parser fixtures from the Python audit reference.
Usage: PYTHONPATH=/reference/src python generate-policy-parity.py OUTPUT.json
No credentials or Vault connection are used.
"""
import itertools,json,sys
from dataclasses import asdict
from pathlib import Path
from vault_security_audit.analysis.parser import parse_policy
from vault_security_audit.analysis.policy_rules import POLICY_DETECTORS
from vault_security_audit.analysis.base import PolicyTarget,AuditContext
from vault_security_audit.config import AuditConfig
from vault_security_audit.model import Policy,Mount
mounts=(Mount('','secret/','kv',None,None,'secret'),Mount('','secret/nested/','kv',None,None,'secret'),Mount('','cubbyhole/','cubbyhole',None,None,'secret'))
# python-hcl2 8.x retains quoted literal lexemes in attributes. Compare decoded
# literal semantics while retaining the raw oracle attributes separately.
def literal(value):
    if isinstance(value,dict): return {literal(k):literal(v) for k,v in value.items()}
    if isinstance(value,list): return [literal(v) for v in value]
    if isinstance(value,str) and value.startswith('"<<') and value.endswith('"'):
        lines=value[1:-1].splitlines(); return '\n'.join(lines[1:-1])+'\n'
    if isinstance(value,str) and value.startswith('"') and value.endswith('"'):
        try: return json.loads(value)
        except json.JSONDecodeError: pass
    return value
output=[]
def case(name,source):
    document=parse_policy(source)
    target=PolicyTarget(Policy('','demo',source,''),document,mounts)
    context=AuditContext(AuditConfig(),{}, {})
    findings=[]
    for detector in POLICY_DETECTORS.values():
        for f in detector.evaluate(target,context):findings.append({'ruleId':f.rule.rule_id,'severity':f.rule.severity,'evidence':f.evidence_data,'line':f.line,'matchedBlock':f.matched_block})
    output.append({'name':name,'source':source,'blocks':[{'path':b.path,'capabilities':b.capabilities,'attributes':literal(b.attributes),'line':b.line,'source':b.source,'leadingComments':b.leading_comments} for b in document.paths], 'pythonAttributes':[b.attributes for b in document.paths], 'expected':sorted(findings,key=lambda f:f['ruleId'])})
paths=['*','+','secret/*','secret/data/*','secret/metadata/*','secret/nested/*','secret/team/*','cubbyhole/*','+/data/*','+/metadata/*','+/data/team','sys/*','auth/+/role/*','sys/policies/acl/*','sys/policies/acl/demo','sys/policies/acl/other','sys/policy/default','sys/auth','sys/auth/kubernetes','sys/auth/*','auth/token/create','auth/token/create-orphan','auth/token/create/demo','auth/token/roles/demo','sys/audit','sys/audit/file','sys/audit-hash/file','sys/mounts','sys/mounts/secret','other/path']
for i,(path,caps) in enumerate(itertools.product(paths,[['read'],['list'],['update'],['read','sudo'],['deny'],['deny','update','sudo']])):
    case(f'policy-{i}','# review this block\npath '+json.dumps(path)+' {\n capabilities = '+json.dumps(caps)+'\n}')
case('comments-and-restrictions','''# path "*" {capabilities=["sudo"]}
/* path "*" {capabilities=["update"]} */
// real policy follows
path "secret/data/demo" {
 capabilities = [
 # read only
 "read",
 ]
 allowed_parameters = {"name"=["a","b"], "nested"=[{"key"="value"}]}
 required_parameters = ["name"]
 min_wrapping_ttl = "1m"
 max_wrapping_ttl = "1h"
}
''')
case('template-and-inline-blocks','path "secret/{{identity.entity.id}}/*" {capabilities=["read"]}, path "sys/audit" {capabilities=["update"]}')
case('escaped-label','path "secret/a\\\"b" {capabilities=["read"]}')
case('duplicate-paths','path "*" {capabilities=["read"]}\npath "*" {capabilities=["deny"]}')
case('empty-policy','# empty policy\n')
case('heredoc','''path "secret/*" {
 capabilities=["read"]
 description=<<TEXT
literal path "*" { capabilities = ["sudo"] }
TEXT
}
''')
Path(sys.argv[1]).write_text(json.dumps(output,separators=(',',':'))+'\n')
print(f'{len(output)} policy fixtures; {sum(len(f["expected"]) for f in output)} findings')
