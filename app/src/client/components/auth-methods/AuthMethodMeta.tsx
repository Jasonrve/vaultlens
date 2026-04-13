/**
 * AuthMethodMeta — parses an auth method description for:
 *  - URLs → rendered as clickable link-pills with service icons
 *  - key=value or key:value tokens → rendered as repo-badge chips
 */

interface ServiceConfig {
  label: string;
  color: string;
  /** Inline SVG path data (viewBox="0 0 24 24") */
  svgPath: string;
}

const SERVICE_MAP: Record<string, ServiceConfig> = {
  rancher: {
    label: 'Rancher',
    color: '#0075A8',
    // Simplified Rancher hex-badge R icon
    svgPath:
      'M12 2L3 7v10l9 5 9-5V7L12 2zm0 2.236L19 8.382v7.236L12 19.764 5 15.618V8.382L12 4.236zM10 9v6h1.5v-2h1l1.5 2H15.5l-1.7-2.2A2 2 0 0 0 14 9H10zm1.5 1.5H14a.5.5 0 0 1 0 1h-2.5v-1z',
  },
  argo: {
    label: 'Argo',
    color: '#E96D2C',
    // Simplified Argo octopus/compass icon
    svgPath:
      'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 2a8 8 0 0 1 8 8 8 8 0 0 1-8 8 8 8 0 0 1-8-8 8 8 0 0 1 8-8zm0 2.5L9 10l-1.5 3.5L12 16l4.5-2.5L15 10 12 6.5zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  },
  kubernetes: {
    label: 'Kubernetes',
    color: '#326CE5',
    // Kubernetes helm wheel — 7-spoke wheel with center hub
    svgPath:
      'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 2c4.41 0 8 3.59 8 8s-3.59 8-8 8-8-3.59-8-8 3.59-8 8-8zm0 3a1.5 1.5 0 0 0-1.5 1.5v.55l-3.63 2.1a1.5 1.5 0 1 0 .75 1.3l3.38-1.83V12a1.5 1.5 0 0 0 0 0V9.85l3.38 1.82a1.5 1.5 0 1 0 .75-1.3L11.5 8.3V7.5A1.5 1.5 0 0 0 12 5zm-5 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm10 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM9 15.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-3-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  },
  github: {
    label: 'GitHub',
    color: '#24292F',
    // GitHub Octocat mark (CC0 / MIT licensed icon from simpleicons.org)
    svgPath:
      'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  backstage: {
    label: 'Backstage',
    color: '#9BF0E1',
    // Backstage simplified logo — a record player "B" shape
    svgPath:
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4-2c0 1.1-.9 2-2 2h-1v-2h1v-2h-1v-2h1c1.1 0 2 .9 2 2v2z',
  },
  roadie: {
    label: 'Roadie',
    color: '#7C3AED',
    // Roadie simplified logo — road perspective lines
    svgPath:
      'M12 3L4 20h2.5l1.5-3h8l1.5 3H20L12 3zm0 3.8l2.8 7.2H9.2L12 6.8z',
  },
};

function detectService(url: string): ServiceConfig | null {
  const lower = url.toLowerCase();
  if (lower.includes('rancher')) return SERVICE_MAP['rancher']!;
  if (lower.includes('argocd') || lower.includes('argo')) return SERVICE_MAP['argo']!;
  if (lower.includes('kubernetes') || lower.includes('k8s')) return SERVICE_MAP['kubernetes']!;
  if (lower.includes('github.com') || lower.includes('github.io')) return SERVICE_MAP['github']!;
  if (lower.includes('backstage')) return SERVICE_MAP['backstage']!;
  if (lower.includes('roadie')) return SERVICE_MAP['roadie']!;
  return null;
}

interface ParsedMeta {
  links: Array<{ url: string; service: ServiceConfig | null }>;
  badges: Array<{ key: string; value: string }>;
}

export function parseAuthMethodDescription(description: string): ParsedMeta {
  const links: ParsedMeta['links'] = [];
  const badges: ParsedMeta['badges'] = [];

  if (!description) return { links, badges };

  // Extract URLs
  const urlRegex = /https?:\/\/[^\s,;'"]+/gi;
  let remaining = description;
  const foundUrls = description.match(urlRegex) ?? [];
  for (const url of foundUrls) {
    remaining = remaining.replace(url, ' ').trim();
    links.push({ url, service: detectService(url) });
  }

  // Extract key=value or key:value tokens from remaining text
  const tokens = remaining.split(/[\s,;]+/).filter(Boolean);
  for (const token of tokens) {
    const match = token.match(/^([\w][\w.-]*)[:=](.+)$/);
    if (match) {
      badges.push({ key: match[1]!, value: match[2]! });
    }
  }

  return { links, badges };
}

// ── Badge colours ─────────────────────────────────────────────────────────────
const BADGE_COLORS = [
  { bg: '#4c8cf8', text: '#fff' },
  { bg: '#16a34a', text: '#fff' },
  { bg: '#d97706', text: '#fff' },
  { bg: '#9333ea', text: '#fff' },
  { bg: '#0891b2', text: '#fff' },
  { bg: '#be123c', text: '#fff' },
];

function badgeColor(index: number) {
  return BADGE_COLORS[index % BADGE_COLORS.length]!;
}

// ── Components ────────────────────────────────────────────────────────────────

interface AuthMethodMetaProps {
  description: string;
}

export function AuthMethodMeta({ description }: AuthMethodMetaProps) {
  const { links, badges } = parseAuthMethodDescription(description);
  if (links.length === 0 && badges.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Service link pills */}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map(({ url, service }) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
              style={{
                borderColor: service?.color ?? '#6b7280',
                color: service?.color ?? '#6b7280',
                backgroundColor: `${service?.color ?? '#6b7280'}18`,
              }}
            >
              {service ? (
                <>
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3 w-3 shrink-0"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d={service.svgPath} />
                  </svg>
                  <span>{service.label}</span>
                </>
              ) : (
                <span className="max-w-[200px] truncate text-xs">{url}</span>
              )}
            </a>
          ))}
        </div>
      )}

      {/* Key:value repo-badge style chips */}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {badges.map(({ key, value }, i) => {
            const { bg, text } = badgeColor(i);
            return (
              <span
                key={`${key}-${i}`}
                className="inline-flex overflow-hidden rounded text-xs font-medium"
              >
                <span className="bg-gray-700 px-1.5 py-0.5 text-white">{key}</span>
                <span style={{ backgroundColor: bg, color: text }} className="px-1.5 py-0.5">
                  {value}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
