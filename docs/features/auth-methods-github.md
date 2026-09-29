# GitHub Auth

GitHub auth lets users authenticate with a GitHub account or organization membership. Vault maps the authenticated GitHub identity to policies through configured teams, organizations, or users.

## Configure The Mount

Configure the GitHub OAuth application and allowed organizations in the **Configuration** tab. The GitHub OAuth callback must be reachable by the users signing in.

## Roles

GitHub auth does not use Vault roles in the same way as Kubernetes or AppRole. Policy mapping is configured with GitHub auth parameters such as organization and team mappings. VaultLens shows an empty Roles table for GitHub mounts rather than treating the absence of roles as an error.

## Login

Select the GitHub mount on the VaultLens login page and complete the GitHub authorization flow. Vault then issues a token containing the policies matched from the user's GitHub identity.

## Security Notes

Restrict allowed organizations and teams to the groups that need access. Review the resulting Vault policies regularly; GitHub membership controls who can obtain them.
