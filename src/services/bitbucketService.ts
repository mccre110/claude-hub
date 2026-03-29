/**
 * Bitbucket Cloud REST API v2.0 service layer.
 *
 * Authentication:
 * - OAuth 2.0 access token (BITBUCKET_TOKEN): sent as Bearer token
 * - App Password (BITBUCKET_TOKEN + BITBUCKET_USERNAME): sent as Basic auth
 *   To use App Password mode, set BITBUCKET_AUTH_MODE=basic in the environment.
 *
 * API reference: https://developer.atlassian.com/cloud/bitbucket/rest/intro/
 */
import { createLogger } from '../utils/logger';
import secureCredentials from '../utils/secureCredentials';
import type {
  BitbucketPullRequest,
  BitbucketCommitStatus,
  BitbucketIssue
} from '../types/bitbucket';

const logger = createLogger('bitbucketService');

const BB_API_BASE = 'https://api.bitbucket.org/2.0';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build the Authorization header value.
 *
 * Bitbucket supports two auth methods:
 * 1. OAuth 2.0 Bearer token  →  `Authorization: Bearer <access_token>`
 * 2. App Password (Basic)    →  `Authorization: Basic base64(username:app_password)`
 *
 * Set BITBUCKET_AUTH_MODE=basic to use App Password mode (requires BITBUCKET_USERNAME).
 * Default is Bearer token mode (BITBUCKET_AUTH_MODE=bearer or unset).
 */
function buildAuthHeader(): string {
  const token = secureCredentials.get('BITBUCKET_TOKEN');
  if (!token) {
    throw new Error('BITBUCKET_TOKEN is not configured');
  }

  const authMode = process.env['BITBUCKET_AUTH_MODE'] ?? 'bearer';

  if (authMode === 'basic') {
    const username = process.env['BITBUCKET_USERNAME'];
    if (!username) {
      throw new Error(
        'BITBUCKET_USERNAME is required when BITBUCKET_AUTH_MODE=basic (App Password auth)'
      );
    }
    const encoded = Buffer.from(`${username}:${token}`).toString('base64');
    return `Basic ${encoded}`;
  }

  return `Bearer ${token}`;
}

async function bbFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BB_API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: buildAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> | undefined)
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Bitbucket API error ${response.status} ${response.statusText}: ${body}`);
  }

  // 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

// ─── Comment operations ───────────────────────────────────────────────────────

/**
 * Post a comment on a pull request.
 */
export async function postPRComment(
  workspace: string,
  repoSlug: string,
  prId: number,
  body: string
): Promise<void> {
  logger.info({ workspace, repoSlug, prId }, 'Posting PR comment');

  await bbFetch(`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content: { raw: body } })
  });
}

/**
 * Post a comment on an issue.
 */
export async function postIssueComment(
  workspace: string,
  repoSlug: string,
  issueId: number,
  body: string
): Promise<void> {
  logger.info({ workspace, repoSlug, issueId }, 'Posting issue comment');

  await bbFetch(`/repositories/${workspace}/${repoSlug}/issues/${issueId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content: { raw: body } })
  });
}

// ─── Issue operations ─────────────────────────────────────────────────────────

/**
 * Retrieve a single issue by ID.
 */
export async function getIssue(
  workspace: string,
  repoSlug: string,
  issueId: number
): Promise<BitbucketIssue> {
  logger.info({ workspace, repoSlug, issueId }, 'Fetching issue');
  return bbFetch<BitbucketIssue>(`/repositories/${workspace}/${repoSlug}/issues/${issueId}`);
}

/**
 * Update an issue's kind, priority, and/or component.
 *
 * Bitbucket's issue PUT endpoint replaces the full issue object, so we first
 * GET the current state and merge in only the changed fields. This prevents
 * inadvertently resetting other fields (title, content, state, etc.) to defaults.
 *
 * Bitbucket Cloud issues do not support arbitrary labels like GitHub.
 * Structured fields are: kind, priority, component.
 */
export async function updateIssueFields(
  workspace: string,
  repoSlug: string,
  issueId: number,
  fields: {
    kind?: BitbucketIssue['kind'];
    priority?: BitbucketIssue['priority'];
    component?: string;
  }
): Promise<void> {
  logger.info({ workspace, repoSlug, issueId, fields }, 'Updating issue fields');

  // Fetch current issue state to avoid wiping existing data
  const current = await getIssue(workspace, repoSlug, issueId);

  const updated: Record<string, unknown> = {
    title: current.title,
    content: current.content,
    kind: fields.kind ?? current.kind,
    priority: fields.priority ?? current.priority,
    state: current.state
  };

  if (fields.component !== undefined) {
    updated['component'] = { name: fields.component };
  } else if (current.component) {
    updated['component'] = current.component;
  }

  await bbFetch(`/repositories/${workspace}/${repoSlug}/issues/${issueId}`, {
    method: 'PUT',
    body: JSON.stringify(updated)
  });
}

// ─── Pull Request operations ──────────────────────────────────────────────────

/**
 * Retrieve full PR details.
 */
export async function getPullRequestDetails(
  workspace: string,
  repoSlug: string,
  prId: number
): Promise<BitbucketPullRequest> {
  logger.info({ workspace, repoSlug, prId }, 'Fetching PR details');
  return bbFetch<BitbucketPullRequest>(
    `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`
  );
}

// ─── Commit status operations ─────────────────────────────────────────────────

/**
 * Retrieve all commit statuses for a given commit SHA.
 *
 * Official endpoint: GET /repositories/{workspace}/{repo_slug}/commit/{commit}/statuses
 */
export async function getCommitStatuses(
  workspace: string,
  repoSlug: string,
  commitSha: string
): Promise<BitbucketCommitStatus[]> {
  logger.info({ workspace, repoSlug, commitSha }, 'Fetching commit statuses');

  const response = await bbFetch<{ values: BitbucketCommitStatus[]; next?: string }>(
    `/repositories/${workspace}/${repoSlug}/commit/${commitSha}/statuses`
  );
  return response.values ?? [];
}

/**
 * Check if all commit statuses for a commit are successful.
 * Returns false when no statuses exist (not yet reported).
 */
export async function allStatusesSuccessful(
  workspace: string,
  repoSlug: string,
  commitSha: string
): Promise<boolean> {
  const statuses = await getCommitStatuses(workspace, repoSlug, commitSha);
  if (statuses.length === 0) {
    return false;
  }
  return statuses.every(s => s.state === 'SUCCESSFUL');
}

// ─── PR listing for a commit ──────────────────────────────────────────────────

/**
 * Find open pull requests that have the given commit SHA as their source.
 *
 * Uses: GET /repositories/{workspace}/{repo_slug}/commit/{commit}/pullrequests
 */
export async function findPRsForCommit(
  workspace: string,
  repoSlug: string,
  commitSha: string
): Promise<BitbucketPullRequest[]> {
  logger.info({ workspace, repoSlug, commitSha }, 'Finding PRs for commit');

  try {
    const response = await bbFetch<{ values: BitbucketPullRequest[] }>(
      `/repositories/${workspace}/${repoSlug}/commit/${commitSha}/pullrequests`
    );
    return (response.values ?? []).filter(pr => pr.state === 'OPEN');
  } catch (error) {
    logger.warn({ err: error, commitSha }, 'Failed to fetch PRs for commit; returning empty list');
    return [];
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Extract workspace and repo slug from a Bitbucket full_name string ("workspace/repo-slug").
 */
export function parseFullName(fullName: string): { workspace: string; repoSlug: string } {
  const parts = fullName.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid Bitbucket repository full_name: "${fullName}"`);
  }
  return { workspace: parts[0], repoSlug: parts[1] };
}
