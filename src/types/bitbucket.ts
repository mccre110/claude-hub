/**
 * Bitbucket Cloud webhook payload types
 * Based on Bitbucket Cloud REST API v2.0 and official webhook event documentation:
 * https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/
 */

import type { BaseWebhookPayload } from './webhook';

// ─── Core Object Types ────────────────────────────────────────────────────────

/**
 * Bitbucket account. The `type` discriminator can be 'user', 'team', or 'app'
 * (Bitbucket docs: "Account type can be one of three subtypes — User, Team or AppUser").
 */
export interface BitbucketUser {
  type: 'user' | 'team' | 'app';
  uuid: string;
  account_id?: string;
  nickname: string;
  display_name: string;
  links: {
    self: { href: string };
    html?: { href: string };
    avatar?: { href: string };
  };
}

export interface BitbucketWorkspace {
  type: 'workspace';
  uuid: string;
  slug: string;
  name: string;
  links: {
    self: { href: string };
    html?: { href: string };
    avatar?: { href: string };
  };
}

export interface BitbucketRepository {
  type: 'repository';
  uuid: string;
  name: string;
  full_name: string; // "workspace/repo-slug"
  is_private: boolean;
  /** Present in older payloads; prefer `workspace` in newer ones */
  owner?: BitbucketUser;
  /** Present in newer payloads */
  workspace?: BitbucketWorkspace;
  scm?: 'git' | 'hg';
  mainbranch?: { name: string; type: string };
  links: {
    self: { href: string };
    html: { href: string };
    avatar?: { href: string };
  };
}

export interface BitbucketIssue {
  type: 'issue';
  id: number;
  title: string;
  content: {
    raw: string;
    markup: string;
    html: string;
  };
  /**
   * Issue state values per official docs:
   * submitted | new | open | on hold | resolved | duplicate | invalid | wontfix | closed
   */
  state:
    | 'submitted'
    | 'new'
    | 'open'
    | 'on hold'
    | 'resolved'
    | 'duplicate'
    | 'invalid'
    | 'wontfix'
    | 'closed';
  /**
   * Issue category. The REST API names this field `kind`; webhook payloads
   * may present this as `kind` as well (despite docs labelling it `type`,
   * which conflicts with Bitbucket's object-type discriminator convention).
   */
  kind: 'bug' | 'enhancement' | 'proposal' | 'task';
  priority: 'trivial' | 'minor' | 'major' | 'critical' | 'blocker';
  component?: { name: string };
  milestone?: { name: string };
  version?: { name: string };
  reporter: BitbucketUser;
  assignee?: BitbucketUser;
  created_on: string;
  updated_on: string;
  links: {
    self: { href: string };
    html: { href: string };
  };
}

export interface BitbucketComment {
  /** 'issue_comment' | 'pullrequest_comment' — or just 'comment' in some payloads */
  type: string;
  id: number;
  content: {
    raw: string;
    markup: string;
    html: string;
  };
  /** Present for inline PR comments */
  inline?: {
    path?: string;
    from?: number | null;
    to?: number | null;
  };
  parent?: { id: number };
  created_on: string;
  updated_on: string;
  author: BitbucketUser;
  links: {
    self: { href: string };
    html: { href: string };
  };
}

export interface BitbucketPullRequest {
  type: 'pullrequest';
  id: number;
  title: string;
  description: string;
  /** Official states: OPEN | MERGED | DECLINED (SUPERSEDED is an internal state) */
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  /** true when the PR is a draft */
  draft: boolean;
  author: BitbucketUser;
  source: {
    branch: { name: string };
    commit: { hash: string; type: string };
    repository: BitbucketRepository;
  };
  destination: {
    branch: { name: string };
    commit: { hash: string; type: string };
    repository: BitbucketRepository;
  };
  merge_commit?: { hash: string };
  close_source_branch?: boolean;
  closed_by?: BitbucketUser;
  reason?: string;
  reviewers: BitbucketUser[];
  participants: Array<{
    user: BitbucketUser;
    role: 'AUTHOR' | 'REVIEWER' | 'PARTICIPANT';
    approved: boolean;
    state?: 'approved' | 'changes_requested' | null;
  }>;
  created_on: string;
  updated_on: string;
  links: {
    self: { href: string };
    html: { href: string };
    commits: { href: string };
  };
}

/**
 * Commit status object as it appears in the `repo:commit_status_created` and
 * `repo:commit_status_updated` webhook payloads.
 *
 * IMPORTANT: The webhook payload does NOT contain a `commit.hash` field directly.
 * The commit SHA must be extracted from `links.commit.href`.
 * URL format: .../repositories/{workspace}/{repo_slug}/commit/{sha}
 *
 * Valid states per official docs: INPROGRESS | SUCCESSFUL | FAILED
 * (STOPPED is not in official docs but is accepted by the REST API)
 */
export interface BitbucketCommitStatus {
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED';
  key: string;
  name?: string;
  url: string;
  description?: string;
  /** Always 'build' per current Bitbucket docs */
  type?: 'build';
  created_on: string;
  updated_on: string;
  links: {
    /** URL points to: .../repositories/{ws}/{repo}/commit/{sha} — parse SHA from here */
    commit: { href: string };
    self: { href: string };
  };
}

// ─── Webhook Event Payload Interfaces ────────────────────────────────────────

/** issue:created */
export interface BitbucketIssueCreatedPayload {
  actor: BitbucketUser;
  issue: BitbucketIssue;
  repository: BitbucketRepository;
}

/** issue:comment_created */
export interface BitbucketIssueCommentPayload {
  actor: BitbucketUser;
  comment: BitbucketComment;
  issue: BitbucketIssue;
  repository: BitbucketRepository;
}

/** pullrequest:comment_created */
export interface BitbucketPRCommentPayload {
  actor: BitbucketUser;
  comment: BitbucketComment;
  pullrequest: BitbucketPullRequest;
  repository: BitbucketRepository;
}

/** repo:commit_status_created | repo:commit_status_updated */
export interface BitbucketCommitStatusPayload {
  actor: BitbucketUser;
  commit_status: BitbucketCommitStatus;
  repository: BitbucketRepository;
}

// ─── Normalized Webhook Event ─────────────────────────────────────────────────

/**
 * Bitbucket-specific webhook payload that extends the base webhook payload.
 * The `event` field matches the X-Event-Key header value (e.g., "issue:created").
 */
export interface BitbucketWebhookEvent extends BaseWebhookPayload {
  bitbucketEvent: string; // X-Event-Key header
  hookUuid?: string; // X-Hook-UUID header
  requestUuid?: string; // X-Request-UUID header (unique per delivery)
  attemptNumber?: number; // X-Attempt-Number header (1 = first attempt; 2-3 = retry)
  repository?: BitbucketRepository;
  actor?: BitbucketUser;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Extract the commit SHA from a Bitbucket commit status `links.commit.href` URL.
 *
 * URL format: https://api.bitbucket.org/2.0/repositories/{ws}/{repo}/commit/{sha}
 * Returns null if the URL cannot be parsed.
 */
export function extractCommitShaFromHref(href: string): string | null {
  const match = href.match(/\/commit\/([0-9a-f]+)\/?$/i);
  return match ? match[1] : null;
}
