// Generates the GitHub stats SVG cards committed under assets/.
// Runs on GitHub Actions (see .github/workflows/stats.yml) — no external service.
//
// Token: uses STATS_TOKEN when available (a classic PAT with `repo` scope, which
// lets private contributions be counted), otherwise falls back to the workflow's
// built-in GITHUB_TOKEN, which sees public activity only.

import { mkdir, writeFile } from "node:fs/promises";

const LOGIN = process.env.GH_LOGIN ?? "MatheusBorgesDev";
const TOKEN = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error("Missing STATS_TOKEN / GITHUB_TOKEN");
  process.exit(1);
}

const THEMES = {
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    accent: "#58a6ff",
    text: "#c9d1d9",
    muted: "#8b949e",
    track: "#21262d",
  },
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    accent: "#0969da",
    text: "#1f2328",
    muted: "#656d76",
    track: "#eaeef2",
  },
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Ubuntu,Roboto,Helvetica,Arial,sans-serif";

const QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    contributionsCollection {
      totalPullRequestContributions
      contributionCalendar { totalContributions }
    }
    repositoriesContributedTo(
      first: 1
      contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, REPOSITORY]
    ) { totalCount }
    pullRequests { totalCount }
    repositories(
      first: 100
      ownerAffiliations: OWNER
      isFork: false
      privacy: PUBLIC
    ) {
      totalCount
      nodes {
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": LOGIN,
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  if (body.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data.user;
}

function topLanguages(repos, limit = 6) {
  const sizes = new Map();
  const colors = new Map();

  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      sizes.set(node.name, (sizes.get(node.name) ?? 0) + size);
      colors.set(node.name, node.color ?? "#8b949e");
    }
  }

  const total = [...sizes.values()].reduce((sum, n) => sum + n, 0);
  if (total === 0) return [];

  return [...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, size]) => ({
      name,
      color: colors.get(name),
      percent: (size / total) * 100,
    }))
    // Anything under 1% is noise on the bar and clutters the legend.
    .filter((lang) => lang.percent >= 1)
    .slice(0, limit);
}

const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );

const WIDTH = 460;
const HEIGHT = 200;

function frame(theme, title, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(title)}">
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="8" fill="${theme.bg}" stroke="${theme.border}"/>
  <text x="26" y="38" font-family="${FONT}" font-size="17" font-weight="600" fill="${theme.accent}">${escapeXml(title)}</text>
${inner}
</svg>
`;
}

function statsCard(theme, user) {
  const rows = [
    [
      "Contributions (last year)",
      user.contributionsCollection.contributionCalendar.totalContributions,
    ],
    ["Pull requests opened", user.pullRequests.totalCount],
    ["Repositories contributed to", user.repositoriesContributedTo.totalCount],
    ["Public repositories", user.repositories.totalCount],
  ];

  const inner = rows
    .map(([label, value], i) => {
      const y = 82 + i * 30;
      return `  <text x="26" y="${y}" font-family="${FONT}" font-size="13.5" fill="${theme.muted}">${escapeXml(label)}</text>
  <text x="${WIDTH - 26}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="600" fill="${theme.text}">${value}</text>`;
    })
    .join("\n");

  return frame(theme, "GitHub Stats", inner);
}

function languagesCard(theme, languages) {
  const barX = 26;
  const barY = 62;
  const barW = WIDTH - 52;
  const barH = 11;

  let offset = 0;
  const segments = languages
    .map((lang) => {
      const w = (lang.percent / 100) * barW;
      const seg = `  <rect x="${(barX + offset).toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" fill="${lang.color}"/>`;
      offset += w;
      return seg;
    })
    .join("\n");

  // Centre the legend block in the space left under the bar, so the card stays
  // balanced whether it ends up with two rows of languages or three.
  const rowGap = 30;
  const rowCount = Math.ceil(languages.length / 2);
  const legendTop =
    barY + barH + (HEIGHT - (barY + barH) - rowCount * rowGap) / 2 + 20;

  const legend = languages
    .map((lang, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = barX + col * ((barW + 8) / 2);
      const y = legendTop + row * rowGap;
      return `  <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${lang.color}"/>
  <text x="${x + 18}" y="${y}" font-family="${FONT}" font-size="13.5" fill="${theme.text}">${escapeXml(lang.name)}</text>
  <text x="${x + 18 + 118}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="13.5" fill="${theme.muted}">${lang.percent.toFixed(1)}%</text>`;
    })
    .join("\n");

  const inner = `  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}"/></clipPath>
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="${theme.track}"/>
  <g clip-path="url(#bar)">
${segments}
  </g>
${legend}`;

  return frame(theme, "Most Used Languages", inner);
}

const user = await fetchStats();
const languages = topLanguages(user.repositories.nodes);

await mkdir("assets", { recursive: true });

for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(`assets/stats-${name}.svg`, statsCard(theme, user));
  await writeFile(`assets/languages-${name}.svg`, languagesCard(theme, languages));
}

console.log(
  `Generated cards for ${user.name}: ` +
    `${user.contributionsCollection.contributionCalendar.totalContributions} contributions, ` +
    `${languages.length} languages (top: ${languages[0]?.name ?? "n/a"}).`,
);
