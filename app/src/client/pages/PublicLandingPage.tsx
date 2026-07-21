import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

type SectionItem = {
  title: string;
  body: string;
  bullets: string[];
};

const featureGroups: Array<{ name: string; items: SectionItem[] }> = [
  {
    name: 'Secret management',
    items: [
      {
        title: 'Browse KV v1 and v2 with confidence',
        body: 'VaultLens helps people work with mounted secret engines without losing the context Vault already enforces.',
        bullets: [
          'Create, edit, merge, and delete secrets from a clean web UI.',
          'View version metadata, timestamps, and custom fields in one place.',
          'Support for partial updates lets users change specific keys without exposing values they cannot read.',
        ],
      },
      {
        title: 'Understand access before you touch data',
        body: 'The UI keeps Vault’s ACL model visible instead of hiding it behind a generic form.',
        bullets: [
          'Secret field names can remain visible even when values are masked.',
          'Read/write operations still flow through Vault permissions.',
          'The permission tester shows how policies contribute to an allow or deny result.',
        ],
      },
    ],
  },
  {
    name: 'Security and sharing',
    items: [
      {
        title: 'Share secrets without exposing plaintext',
        body: 'Recipients open a link and decrypt entirely in the browser; the server never sees the secret value.',
        bullets: [
          'OpenPGP encryption with AES-256.',
          'Configurable expiration from 1 hour to 7 days.',
          'One-time-view links that self-destruct after first use.',
        ],
      },
      {
        title: 'Keep admins and automation separated',
        body: 'VaultLens distinguishes UI administration from the system token used by background services.',
        bullets: [
          'Admin access stays thin and human-focused.',
          'Background services use a dedicated system token path.',
          'No HashiCorp affiliation is implied; the project is community maintained.',
        ],
      },
    ],
  },
  {
    name: 'Operations and governance',
    items: [
      {
        title: 'Automate the boring parts',
        body: 'Rotation, backup, and webhook workflows are built into the same app instead of being separate scripts.',
        bullets: [
          'KV v2 secret rotation via custom metadata.',
          'Instant or scheduled backups with one-click restore.',
          'HMAC-signed webhook notifications from audit events.',
        ],
      },
      {
        title: 'See what is happening inside Vault',
        body: 'Visibility tools help operators quickly spot seal state, request activity, and policy drift.',
        bullets: [
          'Analytics for health, seal status, storage backend, and counters.',
          'Audit log search with operation filtering and request/response details.',
          'Identity graphs for entities, groups, aliases, and policies.',
        ],
      },
    ],
  },
  {
    name: 'Customization and deployment',
    items: [
      {
        title: 'Brand it for the team that owns it',
        body: 'VaultLens can match internal naming and visual identity without forking the app.',
        bullets: [
          'Custom app name, logo, primary color, and secondary color.',
          'Live preview while adjusting branding settings.',
          'Configuration can live on disk or in Vault KV, depending on deployment needs.',
        ],
      },
      {
        title: 'Deploy in the way your team already ships',
        body: 'The project supports standalone Docker, Docker Compose, and Helm / Kubernetes deployments.',
        bullets: [
          'Single-container image on GitHub Container Registry.',
          'Compose for small and medium environments.',
          'Helm chart for production clusters, including Kubernetes auth.',
        ],
      },
    ],
  },
];

const screenshotCards = [
  {
    src: '/screenshots/dashboard.png',
    title: 'Dashboard',
    caption: 'A fast overview of engines, policies, auth methods, and quick navigation.',
  },
  {
    src: '/screenshots/secrets-list.png',
    title: 'Secrets browsing',
    caption: 'List secret engines and inspect paths without losing the Vault mental model.',
  },
  {
    src: '/screenshots/secret-detail.png',
    title: 'Partial updates',
    caption: 'Field names can stay visible even when values are masked by permissions.',
  },
  {
    src: '/screenshots/visualizations.png',
    title: 'Relationship graphs',
    caption: 'Auth, policy, and identity relationships rendered as interactive graphs.',
  },
  {
    src: '/screenshots/permission-tester.png',
    title: 'Permission tester',
    caption: 'See exactly which policies contribute to allow/deny decisions.',
  },
  {
    src: '/screenshots/share-secret.png',
    title: 'Secure sharing',
    caption: 'Share a secret via browser-side encryption and a time-limited link.',
  },
  {
    src: '/screenshots/backup-restore.png',
    title: 'Backup & restore',
    caption: 'Schedule backups and restore saved states with one click.',
  },
  {
    src: '/screenshots/audit-log.png',
    title: 'Audit log',
    caption: 'Searchable, filterable audit events with request and response details.',
  },
];

const quickStartCommands = [
  {
    label: 'Docker run',
    code: `docker run -d \
  --name vaultlens \
  -p 3001:3001 \
  -e VAULT_ADDR=http://your-vault-server:8200 \
  -e VAULT_SYSTEM_TOKEN=your-system-token \
  ghcr.io/Jasonrve/vaultlens:latest`,
  },
  {
    label: 'Helm install',
    code: `helm install vaultlens oci://ghcr.io/jasonrve/charts/vaultlens \
  --set config.vaultAddr=http://vault:8200 \
  --set kubernetesAuth.enabled=true \
  --set kubernetesAuth.role=vaultlens`,
  },
];

const techFoundation = [
  'React 19 + TypeScript for the frontend shell and UI workflows.',
  'Express + Node.js 22 for the server, API routes, and background services.',
  'Tailwind CSS and React Flow for visual hierarchy and relationship graphs.',
  'OpenPGP for browser-side secret sharing encryption.',
  'Docker and Helm for container and Kubernetes deployments.',
  'Prometheus metrics and health endpoints for operational visibility.',
];

const integrations = [
  {
    name: 'GitHub repository',
    body: 'Source, releases, issues, and contribution workflow all live in the open.',
    href: 'https://github.com/Jasonrve/vaultlens',
  },
  {
    name: 'GitHub Container Registry',
    body: 'Pull the prebuilt image directly for Docker or Compose deployments.',
    href: 'https://github.com/Jasonrve/vaultlens/pkgs/container/vaultlens',
  },
  {
    name: 'Helm chart',
    body: 'A production-friendly chart is published in the repository and distributed via OCI.',
    href: 'https://github.com/Jasonrve/vaultlens/tree/main/charts/vaultlens',
  },
  {
    name: 'Documentation site',
    body: 'The GitHub Pages docs site expands on setup, features, architecture, and deployment.',
    href: 'https://jasonrve.github.io/vaultlens/',
  },
];

const faq = [
  {
    q: 'Is VaultLens official HashiCorp software?',
    a: 'No. VaultLens is a community-maintained open-source project and explicitly has no affiliation with HashiCorp.',
  },
  {
    q: 'What license does it use?',
    a: 'The repository is GPLv3 licensed, so the code and releases follow that open-source license.',
  },
  {
    q: 'Does VaultLens change my Vault permissions?',
    a: 'No. VaultLens is a thin layer over Vault. It cannot grant access that Vault itself does not allow.',
  },
  {
    q: 'Can it run without Kubernetes?',
    a: 'Yes. The project supports Docker and Docker Compose, with Helm available for Kubernetes environments.',
  },
  {
    q: 'Is it production ready?',
    a: 'The project calls itself beta and is under active development. It is designed to be practical, but you should evaluate it against your own production requirements.',
  },
  {
    q: 'How are background services secured?',
    a: 'VaultLens separates the UI-facing admin experience from the system token used for automation such as rotation, backups, and webhook delivery.',
  },
];

const comparisonRows = [
  ['Secret browsing', 'Yes', 'Basic KV UI', 'CLI or scripts'],
  ['Policy visualization', 'Yes', 'Raw HCL only', 'Not visualized'],
  ['Secret sharing', 'Yes', 'Not built in', 'Requires custom tooling'],
  ['Backup & restore', 'Yes', 'Not built in', 'Manual export/import'],
  ['Webhooks and rotation', 'Yes', 'Not built in', 'Custom jobs'],
  ['Custom branding', 'Yes', 'Not available', 'Not available'],
];

function useRevealObserver(rootRef: React.RefObject<HTMLElement>, enabled: boolean) {
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!items.length) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      items.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      {
        threshold: 0.16,
        rootMargin: '0px 0px -8% 0px',
      },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [enabled, rootRef]);
}

function delay(ms: number) {
  return { '--reveal-delay': `${ms}ms` } as React.CSSProperties;
}

function SectionLabel({ number, title, delayMs = 0 }: { number: string; title: string; delayMs?: number }) {
  return (
    <p
      data-reveal
      className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400"
      style={delay(delayMs)}
    >
      {number} — {title}
    </p>
  );
}

function LandingCard({ title, body, bullets, delayMs = 0 }: { title: string; body: string; bullets: string[]; delayMs?: number }) {
  return (
    <article
      data-reveal="card"
      className="rounded-2xl border border-slate-800/80 bg-slate-950/70 p-6 shadow-[0_20px_60px_rgba(3,8,20,0.22)] backdrop-blur"
      style={delay(delayMs)}
    >
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-300">{body}</p>
      <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-200">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-sky-400" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function PublicLandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [revealReady, setRevealReady] = useState(false);

  useEffect(() => {
    setRevealReady(true);
  }, []);

  useRevealObserver(rootRef, revealReady);

  const stats = useMemo(
    () => [
      { value: 'GPLv3', label: 'Open source license' },
      { value: 'Docker', label: 'Fast standalone deploy' },
      { value: 'Helm', label: 'Kubernetes distribution' },
      { value: 'Beta', label: 'Actively evolving' },
    ],
    [],
  );

  return (
    <main ref={rootRef} className={`public-landing ${revealReady ? 'reveal-ready' : ''}`}>
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
        <header
          data-reveal
          className="sticky top-4 z-20 rounded-full border border-white/10 bg-slate-950/70 px-4 py-3 shadow-lg backdrop-blur-xl"
          style={delay(0)}
        >
          <div className="flex items-center justify-between gap-4">
            <a href="#top" className="flex items-center gap-3 text-sm font-medium text-white">
              <img src="/logo.png" alt="VaultLens logo" className="h-8 w-8 rounded-xl" />
              <span>VaultLens</span>
            </a>
            <nav className="hidden items-center gap-5 text-sm text-slate-300 md:flex">
              {[
                ['Features', '#features'],
                ['Architecture', '#architecture'],
                ['Compare', '#compare'],
                ['Quick Start', '#quick-start'],
                ['Stack', '#stack'],
                ['FAQ', '#faq'],
              ].map(([label, href]) => (
                <a key={href} href={href} className="transition hover:text-white">
                  {label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/Jasonrve/vaultlens"
                className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-white transition hover:border-sky-400/50 hover:bg-sky-400/10"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <Link
                to="/login"
                className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400"
              >
                Launch app
              </Link>
            </div>
          </div>
        </header>

        <section id="top" className="grid min-h-[82vh] items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <div
              data-reveal
              className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-sm font-medium text-sky-200"
              style={delay(0)}
            >
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              Beta · Community-maintained · Self-hosted Vault UI
            </div>
            <h1
              data-reveal
              className="mt-6 max-w-3xl text-5xl font-semibold tracking-tight text-white sm:text-6xl lg:text-7xl"
              style={delay(90)}
            >
              A modern Vault experience for secrets, policies, and safer day-to-day operations.
            </h1>
            <p
              data-reveal
              className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl"
              style={delay(170)}
            >
              VaultLens brings secret browsing, interactive relationship graphs, secure sharing, backup and restore,
              audit search, webhooks, rotation, and branding into one lightweight web app — while staying inside
              Vault’s own permission model.
            </p>

            <div data-reveal className="mt-8 flex flex-col gap-3 sm:flex-row" style={delay(250)}>
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
              >
                Launch the app
              </Link>
              <a
                href="https://jasonrve.github.io/vaultlens/"
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:border-sky-400/60 hover:bg-white/5"
                target="_blank"
                rel="noreferrer"
              >
                Read the docs
              </a>
            </div>

            <div data-reveal className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4" style={delay(320)}>
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <div className="text-xl font-semibold text-white">{stat.value}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div data-reveal className="relative" style={delay(120)}>
            <div className="absolute -inset-6 rounded-[2rem] bg-sky-500/15 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/80 p-4 shadow-[0_35px_100px_rgba(2,6,23,0.45)]">
              <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
                <img
                  src="/screenshots/dashboard.png"
                  alt="VaultLens dashboard screenshot"
                  className="h-full w-full rounded-2xl border border-white/10 object-cover"
                />
                <div className="grid gap-4">
                  {[
                    ['/screenshots/visualizations.png', 'Access graphs'],
                    ['/screenshots/permission-tester.png', 'Permission tester'],
                    ['/screenshots/share-secret.png', 'Secure sharing'],
                  ].map(([src, label], index) => (
                    <div key={src} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
                      <img src={src} alt={label} className="h-40 w-full object-cover" loading="lazy" />
                      <div className="px-4 py-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-400">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="py-20 sm:py-24">
          <SectionLabel number="01" title="Capabilities" />
          <div className="mt-4 max-w-3xl">
            <h2 data-reveal className="text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={delay(60)}>
              Everything people need to work with Vault without wrestling the UI or losing trust.
            </h2>
            <p data-reveal className="mt-4 text-lg leading-8 text-slate-300" style={delay(130)}>
              The site highlights the strongest ideas from the repository and documentation instead of trying to list
              every tiny control. These are the workflows that matter most when someone is deciding whether to adopt
              VaultLens.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {featureGroups.map((group, groupIndex) => (
              <div key={group.name} className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
                <h3 data-reveal className="text-lg font-semibold text-white" style={delay(groupIndex * 60)}>
                  {group.name}
                </h3>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {group.items.map((item, itemIndex) => (
                    <LandingCard
                      key={item.title}
                      title={item.title}
                      body={item.body}
                      bullets={item.bullets}
                      delayMs={groupIndex * 80 + itemIndex * 80}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-20 sm:py-24">
          <SectionLabel number="02" title="Proof" />
          <div className="mt-4 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 data-reveal className="text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={delay(60)}>
                Screenshots show the real product, not a generic template.
              </h2>
              <p data-reveal className="mt-4 text-lg leading-8 text-slate-300" style={delay(120)}>
                The landing page pulls from actual VaultLens screens so the public site can prove the app really does
                the work described in the README and docs.
              </p>
              <div data-reveal className="mt-8 rounded-2xl border border-white/10 bg-slate-950/70 p-5" style={delay(180)}>
                <p className="text-sm font-medium text-white">What this covers</p>
                <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
                  <li>• Dashboard, secrets browsing, and secret details</li>
                  <li>• Policy, identity, and relationship visualizations</li>
                  <li>• Permission testing, secure sharing, backup, audit, and branding</li>
                </ul>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {screenshotCards.map((card, index) => (
                <figure
                  key={card.title}
                  data-reveal
                  className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/70 shadow-[0_25px_80px_rgba(2,6,23,0.25)]"
                  style={delay(index * 70)}
                >
                  <img src={card.src} alt={card.title} className="h-52 w-full object-cover" loading="lazy" />
                  <figcaption className="p-4">
                    <div className="text-sm font-semibold text-white">{card.title}</div>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{card.caption}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section id="architecture" className="py-20 sm:py-24">
          <SectionLabel number="03" title="Architecture" />
          <div className="mt-4 max-w-3xl">
            <h2 data-reveal className="text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={delay(60)}>
              Built around Vault’s own permission boundary.
            </h2>
            <p data-reveal className="mt-4 text-lg leading-8 text-slate-300" style={delay(120)}>
              VaultLens is a thin application layer over HashiCorp Vault. The browser talks to the app, the app talks
              to Vault, and background services use a distinct system token path for automation.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {[
              {
                title: 'Core model',
                body: 'The UI is organized around secrets, policies, auth methods, identity, and operational tooling instead of forcing one generic list view.',
              },
              {
                title: 'Deployment model',
                body: 'The app runs as a single container or in Kubernetes with Helm. Configuration can be file-backed or stored in Vault KV.',
              },
              {
                title: 'Security boundary',
                body: 'VaultLens does not grant permissions. It exposes Vault’s own ACLs, uses httpOnly auth cookies, and keeps sharing encrypted in the browser.',
              },
              {
                title: 'Background services',
                body: 'Rotation, backups, audit watches, and webhooks are separate operational concerns that rely on the system token path.',
              },
              {
                title: 'Data flow',
                body: 'The server renders the SPA, proxies to Vault, and publishes health and metrics endpoints for operators.',
              },
              {
                title: 'Customization',
                body: 'Branding, storage choice, and deployment mode can be tuned without forking the project.',
              },
            ].map((item, index) => (
              <article
                key={item.title}
                data-reveal
                className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6"
                style={delay(index * 70)}
              >
                <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="compare" className="py-20 sm:py-24">
          <SectionLabel number="04" title="Compare" />
          <div className="mt-4 max-w-3xl">
            <h2 data-reveal className="text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={delay(60)}>
              Why people choose VaultLens instead of the native UI alone.
            </h2>
            <p data-reveal className="mt-4 text-lg leading-8 text-slate-300" style={delay(120)}>
              The comparison is intentionally conservative: it only claims what the repository and docs explicitly show.
            </p>
          </div>

          <div data-reveal className="mt-10 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5" style={delay(180)}>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                <thead className="bg-white/5 text-slate-300">
                  <tr>
                    <th className="px-5 py-4 font-medium">Capability</th>
                    <th className="px-5 py-4 font-medium">VaultLens</th>
                    <th className="px-5 py-4 font-medium">Native Vault UI</th>
                    <th className="px-5 py-4 font-medium">CLI / scripts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-slate-200">
                  {comparisonRows.map((row) => (
                    <tr key={row[0]}>
                      <td className="px-5 py-4 font-medium text-white">{row[0]}</td>
                      <td className="px-5 py-4">{row[1]}</td>
                      <td className="px-5 py-4">{row[2]}</td>
                      <td className="px-5 py-4">{row[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="quick-start" className="py-20 sm:py-24">
          <SectionLabel number="05" title="Quick start" />
          <div className="mt-4 max-w-3xl">
            <h2 data-reveal className="text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={delay(60)}>
              Live in minutes with Docker or Helm.
            </h2>
            <p data-reveal className="mt-4 text-lg leading-8 text-slate-300" style={delay(120)}>
              The docs already provide production-oriented setup paths. This site preserves those commands so visitors
              can try the product without hunting through the repo.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {quickStartCommands.map((item, index) => (
              <article
                key={item.label}
                data-reveal
                className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/80"
                style={delay(index * 100)}
              >
                <div className="border-b border-white/10 px-5 py-4 text-sm font-semibold text-white">{item.label}</div>
                <pre className="overflow-x-auto bg-[#06111f] px-5 py-5 text-sm leading-6 text-slate-200">
                  <code>{item.code}</code>
                </pre>
              </article>
            ))}
          </div>
          <div data-reveal className="mt-6 text-sm text-slate-400" style={delay(220)}>
            Expected result: a self-hosted VaultLens instance that can connect to Vault, authenticate users, and
            surface the security and operations workflows described above.
          </div>
        </section>

        <section id="stack" className="py-20 sm:py-24">
          <SectionLabel number="06" title="Stack" />
          <div className="mt-4 max-w-3xl">
            <h2 data-reveal className="text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={delay(60)}>
              The foundation is practical, not decorative.
            </h2>
            <p data-reveal className="mt-4 text-lg leading-8 text-slate-300" style={delay(120)}>
              The implementation choices matter because they explain why the site can ship quickly, stay self-hosted,
              and still support a rich interactive UI.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {techFoundation.map((item, index) => (
              <div
                key={item}
                data-reveal
                className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-slate-200"
                style={delay(index * 60)}
              >
                {item}
              </div>
            ))}
          </div>
        </section>

        <section id="ecosystem" className="py-20 sm:py-24">
          <SectionLabel number="07" title="Ecosystem" />
          <div className="mt-4 max-w-3xl">
            <h2 data-reveal className="text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={delay(60)}>
              The product lives inside a wider open-source workflow.
            </h2>
            <p data-reveal className="mt-4 text-lg leading-8 text-slate-300" style={delay(120)}>
              Source code, releases, docs, and containers all point back to the same project so adopters do not need to
              guess where the authoritative information lives.
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {integrations.map((item, index) => (
              <a
                key={item.name}
                data-reveal
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6 transition hover:border-sky-400/40 hover:bg-white/10"
                style={delay(index * 60)}
              >
                <div className="text-lg font-semibold text-white">{item.name}</div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.body}</p>
                <div className="mt-4 text-sm font-medium text-sky-300">Open link →</div>
              </a>
            ))}
          </div>
        </section>

        <section id="faq" className="py-20 sm:py-24">
          <SectionLabel number="08" title="FAQ" />
          <div className="mt-4 max-w-3xl">
            <h2 data-reveal className="text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={delay(60)}>
              The obvious objections are answered up front.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {faq.map((item, index) => (
              <details
                key={item.q}
                data-reveal
                className="group rounded-2xl border border-white/10 bg-white/5 p-5"
                style={delay(index * 60)}
              >
                <summary className="cursor-pointer list-none text-base font-semibold text-white">
                  {item.q}
                </summary>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="community" className="py-20 sm:py-24">
          <SectionLabel number="09" title="Community" />
          <div
            data-reveal
            className="overflow-hidden rounded-[2rem] border border-sky-400/20 bg-gradient-to-br from-sky-500/15 via-slate-950/90 to-slate-900 p-8 shadow-[0_35px_120px_rgba(3,8,20,0.35)]"
            style={delay(80)}
          >
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Built in the open for contributors, operators, and Vault teams.
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-300">
                VaultLens is GPLv3, actively developed, and meant to be improved in public. Contributions, bug
                reports, examples, and deployment feedback all help sharpen the product for the next team.
              </p>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="https://github.com/Jasonrve/vaultlens"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
              >
                Fork the repository
              </a>
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
              >
                Try the app
              </Link>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/10 pt-10 text-sm text-slate-400">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-semibold text-white">VaultLens</div>
              <div className="mt-1 max-w-2xl leading-6">
                A community-maintained open-source Vault UI. GPLv3 licensed, no HashiCorp affiliation, and designed
                to stay practical in real environments.
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <a href="https://github.com/Jasonrve/vaultlens" target="_blank" rel="noreferrer" className="hover:text-white">
                GitHub
              </a>
              <a href="https://jasonrve.github.io/vaultlens/" target="_blank" rel="noreferrer" className="hover:text-white">
                Docs
              </a>
              <Link to="/login" className="hover:text-white">
                Launch app
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
