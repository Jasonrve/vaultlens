import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'VaultLens',
  description: 'A Modern Web UI for HashiCorp Vault',
  base: '/vaultlens/',
  ignoreDeadLinks: [/^http:\/\/localhost/],

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/vaultlens/logo.png' }],
  ],

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'VaultLens',

    nav: [
      {
        text: 'User Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'Deployment', link: '/guide/deployment' },
        ]
      },
      { text: 'Features', link: '/features/secrets' },
      {
        text: 'Contributing',
        items: [
          { text: 'Overview', link: '/contributing/' },
          { text: 'Local Development', link: '/contributing/local-development' },
          { text: 'Architecture', link: '/architecture/overview' },
          { text: 'System Token', link: '/architecture/system-token' },
          { text: 'Security', link: '/architecture/security' },
        ]
      },
      {
        text: 'Links',
        items: [
          { text: 'GitHub', link: 'https://github.com/Jasonrve/vaultlens' },
          { text: 'Docker Image', link: 'https://github.com/Jasonrve/vaultlens/pkgs/container/vaultlens' },
          { text: 'Releases', link: 'https://github.com/Jasonrve/vaultlens/releases' },
        ]
      }
    ],

    sidebar: {
      // User-facing sidebar — shown for /guide/ and /features/ paths
      '/guide/': [
        {
          text: 'User Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Deployment', link: '/guide/deployment' },
          ]
        },
        {
          text: 'Features',
          collapsed: false,
          items: [
            { text: 'Secret Management', link: '/features/secrets' },
            { text: 'Auth Methods', link: '/features/auth-methods' },
            { text: 'ACL Policies', link: '/features/policies' },
            { text: 'Identity Management', link: '/features/identity' },
            { text: 'Visualizations', link: '/features/visualizations' },
            { text: 'Permission Tester', link: '/features/permission-tester' },
            { text: 'Secret Sharing', link: '/features/sharing' },
            { text: 'Secret Rotation', link: '/features/rotation' },
            { text: 'Backup & Restore', link: '/features/backup-restore' },
            { text: 'Webhooks', link: '/features/webhooks' },
            { text: 'Analytics', link: '/features/analytics' },
            { text: 'Branding', link: '/features/branding' },
          ]
        }
      ],

      '/features/': [
        {
          text: 'User Guide',
          collapsed: true,
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Deployment', link: '/guide/deployment' },
          ]
        },
        {
          text: 'Features',
          collapsed: false,
          items: [
            { text: 'Secret Management', link: '/features/secrets' },
            { text: 'Auth Methods', link: '/features/auth-methods' },
            { text: 'ACL Policies', link: '/features/policies' },
            { text: 'Identity Management', link: '/features/identity' },
            { text: 'Visualizations', link: '/features/visualizations' },
            { text: 'Permission Tester', link: '/features/permission-tester' },
            { text: 'Secret Sharing', link: '/features/sharing' },
            { text: 'Secret Rotation', link: '/features/rotation' },
            { text: 'Backup & Restore', link: '/features/backup-restore' },
            { text: 'Webhooks', link: '/features/webhooks' },
            { text: 'Analytics', link: '/features/analytics' },
            { text: 'Branding', link: '/features/branding' },
          ]
        }
      ],

      // Developer/contributor sidebar — shown for /contributing/ and /architecture/ paths
      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Overview', link: '/contributing/' },
            { text: 'Local Development', link: '/contributing/local-development' },
          ]
        },
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'System Token', link: '/architecture/system-token' },
            { text: 'Security', link: '/architecture/security' },
          ]
        }
      ],

      '/architecture/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Overview', link: '/contributing/' },
            { text: 'Local Development', link: '/contributing/local-development' },
          ]
        },
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'System Token', link: '/architecture/system-token' },
            { text: 'Security', link: '/architecture/security' },
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Jasonrve/vaultlens' }
    ],

    footer: {
      message: 'Released under the GPL-3.0 License.',
      copyright: 'Copyright © 2024–present Jason van Eeden'
    },

    editLink: {
      pattern: 'https://github.com/Jasonrve/vaultlens/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    search: {
      provider: 'local'
    }
  }
})
