import type { Tool, ToolResult } from "./types.js";

// Correct Algora GraphQL endpoint
const ALGORA_GRAPHQL_URL = "https://algora.io/api/graphql";

const GITHUB_API_URL = "https://api.github.com";

interface AlgoraBounty {
  id: string;
  title: string;
  reward: string;
  url: string;
  org: string;
  repo: string;
  issueNumber: number;
  language?: string;
  status: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  labels: { name: string }[];
}

async function fetchAlgoraBounties(org: string): Promise<AlgoraBounty[]> {
  const query = `
    query ListBounties($org: String!) {
      bounties(org: $org, status: "open") {
        nodes {
          id
          title
          reward
          url
          org
          repo
          issueNumber
          language
          status
        }
      }
    }
  `;

  const res = await fetch(ALGORA_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { org } }),
  });

  if (!res.ok) {
    throw new Error(`Algora API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data?: { bounties?: { nodes: AlgoraBounty[] } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(`Algora GraphQL error: ${json.errors[0].message}`);
  }

  return json.data?.bounties?.nodes ?? [];
}

async function fetchGitHubIssue(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<GitHubIssue | null> {
  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/issues/${issueNumber}`;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return (await res.json()) as GitHubIssue;
}

export const listAlgoraBounties: Tool = {
  definition: {
    name: "list_algora_bounties",
    description:
      "List open TypeScript bounties from Algora for a given GitHub org. " +
      "Defaults to tscircuit. Returns bounty titles, rewards, URLs, and issue numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        org: {
          type: "string",
          description: "GitHub org to search bounties for (default: tscircuit)",
        },
        language: {
          type: "string",
          description: "Filter by language (default: TypeScript)",
        },
      },
      required: [],
    },
  },
  async execute(input): Promise<ToolResult> {
    const org = (input.org as string) || "tscircuit";
    const language = ((input.language as string) || "TypeScript").toLowerCase();

    try {
      const bounties = await fetchAlgoraBounties(org);
      const filtered = bounties.filter(
        (b) => !b.language || b.language.toLowerCase() === language
      );

      if (filtered.length === 0) {
        return { success: true, data: `No open ${language} bounties found for ${org}.` };
      }

      return { success: true, data: JSON.stringify(filtered, null, 2) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, data: msg };
    }
  },
};

export const checkTrackedIssues: Tool = {
  definition: {
    name: "check_tracked_issues",
    description:
      "Check the status of specific tracked GitHub issues (#939 and #419 on tscircuit) " +
      "on both Algora and GitHub. Returns bounty availability and issue state.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: {
          type: "string",
          description: "GitHub repo owner (default: tscircuit)",
        },
        repo: {
          type: "string",
          description: "GitHub repo name (default: tscircuit)",
        },
      },
      required: [],
    },
  },
  async execute(input): Promise<ToolResult> {
    const owner = (input.owner as string) || "tscircuit";
    const repo = (input.repo as string) || "tscircuit";
    const trackedIssues = [939, 419];

    try {
      const [algoraBounties, ...ghIssues] = await Promise.all([
        fetchAlgoraBounties(owner),
        ...trackedIssues.map((n) => fetchGitHubIssue(owner, repo, n)),
      ]);

      const results = trackedIssues.map((num, i) => {
        const ghIssue = ghIssues[i] as GitHubIssue | null;
        const algoraBounty = algoraBounties.find((b) => b.issueNumber === num);

        return {
          issueNumber: num,
          github: ghIssue
            ? { title: ghIssue.title, url: ghIssue.html_url, labels: ghIssue.labels.map((l) => l.name) }
            : null,
          algora: algoraBounty
            ? { reward: algoraBounty.reward, url: algoraBounty.url, status: algoraBounty.status }
            : { status: "no bounty posted" },
        };
      });

      return { success: true, data: JSON.stringify(results, null, 2) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, data: msg };
    }
  },
};