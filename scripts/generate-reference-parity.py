"""Generate REF-001 fixtures from the Python reference on PYTHONPATH; no Vault access."""
import itertools,json,sys
from pathlib import Path
from vault_security_audit.analysis.base import AuditContext,RoleTarget
from vault_security_audit.analysis.relationship_rules import MissingPolicyReferenceRule
from vault_security_audit.config import AuditConfig
from vault_security_audit.model import Assignment,Subject
output=[]
for index,(auth,default,known_names,assigned) in enumerate(itertools.product(
    ['approle','token'],[False,True],[['root'],['root','default','reader']],
    [['reader','reader','missing'],['root','vault-admins']])):
    kind='token_role' if auth=='token' else 'approle'
    path=f'auth/{auth}/'+('roles' if auth=='token' else 'role')+'/demo'
    refs=[(p,'assigned') for p in assigned]+([('default','implicit_default')] if default else [])
    data={'auth_type':auth,'token_policies':assigned,'token_no_default_policy':not default}
    if auth=='token':
        data.update(allowed_policies=['allowed-missing'],allowed_policies_glob=['glob-*'],disallowed_policies=['denied'])
        refs += [('allowed-missing','allowed'),('glob-*','allowed_glob'),('denied','disallowed')]
    target=RoleTarget(Subject('',kind,path,'demo',f'auth/{auth}/',auth,data),
      tuple(Assignment('',p,kind,path,'demo',rel,path) for p,rel in refs))
    context=AuditContext(AuditConfig(),{}, {},known_policies=frozenset(('',p) for p in known_names))
    expected=[{'severity':f.rule.severity,'evidence':f.evidence_data} for f in MissingPolicyReferenceRule().evaluate(target,context)]
    output.append({'name':f'reference-{index}','resource':{'kind':'role','path':path,'data':data},'known':known_names,'expected':expected})
Path(sys.argv[1]).write_text(json.dumps(output,separators=(',',':'))+'\n')
print(f'{len(output)} reference fixtures')
