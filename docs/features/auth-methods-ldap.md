# LDAP Auth

LDAP auth authenticates users against an LDAP directory and maps directory groups to Vault policies.

## Configure The Mount

Use **Configuration** to set the LDAP URL, bind settings, user search base, group search base, username attribute, and TLS options. Use LDAPS or StartTLS in production and validate the directory certificate.

## Roles And Policies

LDAP auth normally maps groups to Vault policies instead of using Vault roles. Keep directory group names stable and document which Vault policy each group receives.

## Login

Users select the LDAP mount and sign in with their directory username and password. VaultLens does not store the LDAP password; it is sent only as part of the login request to Vault.

## Security Notes

Use a least-privilege bind account, avoid anonymous searches, and rotate bind credentials. Test group membership with a non-admin account before assigning broad Vault policies.
