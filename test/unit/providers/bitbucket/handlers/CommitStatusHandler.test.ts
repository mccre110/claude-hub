import { CommitStatusHandler } from '../../../../../src/providers/bitbucket/handlers/CommitStatusHandler';
import * as claudeService from '../../../../../src/services/claudeService';
import * as bitbucketService from '../../../../../src/services/bitbucketService';

jest.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
}));

jest.mock('../../../../../src/services/claudeService', () => ({
  processCommand: jest.fn()
}));

jest.mock('../../../../../src/services/bitbucketService', () => ({
  allStatusesSuccessful: jest.fn(),
  findPRsForCommit: jest.fn(),
  postPRComment: jest.fn(),
  parseFullName: jest.fn((s: string) => {
    const [workspace, repoSlug] = s.split('/');
    return { workspace, repoSlug };
  })
}));

// Matches the REAL Bitbucket webhook payload structure for repo:commit_status_updated.
// commit_status does NOT contain a commit.hash field — the SHA lives in links.commit.href.
// See: https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/#Build-status-updated
const COMMIT_SHA = 'abc123def456789012345678901234567890abcd';
const makePayload = (state: string) => ({
  id: 'evt-4',
  timestamp: '',
  event: 'repo:commit_status_updated',
  source: 'bitbucket',
  bitbucketEvent: 'repo:commit_status_updated',
  data: {
    actor: { nickname: 'ci-bot', type: 'user' },
    repository: {
      full_name: 'myws/my-repo',
      name: 'my-repo',
      uuid: '{repo}',
      is_private: false,
      type: 'repository',
      owner: {
        type: 'user',
        uuid: '{u}',
        nickname: 'myws',
        display_name: 'MyWS',
        links: { self: { href: '' } }
      },
      links: { self: { href: '' }, html: { href: '' } }
    },
    commit_status: {
      state,
      key: 'my-pipeline',
      type: 'build',
      url: 'https://example.com/build/1',
      created_on: '2024-01-01T00:00:00Z',
      updated_on: '2024-01-01T00:01:00Z',
      links: {
        // Commit SHA extracted from this URL — matches COMMIT_SHA above
        commit: {
          href: `https://api.bitbucket.org/2.0/repositories/myws/my-repo/commit/${COMMIT_SHA}`
        },
        self: {
          href: 'https://api.bitbucket.org/2.0/repositories/myws/my-repo/commit/statuses/build/my-pipeline'
        }
      }
    }
  }
});

const mockOpenPR = {
  id: 8,
  title: 'Feature Y',
  state: 'OPEN',
  draft: false,
  source: {
    branch: { name: 'feature-y' },
    commit: { hash: COMMIT_SHA, type: 'commit' },
    repository: {} as never
  },
  destination: {
    branch: { name: 'main' },
    commit: { hash: 'fff', type: 'commit' },
    repository: {} as never
  },
  description: '',
  author: {
    type: 'user',
    uuid: '{u}',
    nickname: 'alice',
    display_name: 'Alice',
    links: { self: { href: '' } }
  },
  reviewers: [],
  participants: [],
  created_on: '',
  updated_on: '',
  type: 'pullrequest',
  links: { self: { href: '' }, html: { href: '' }, commits: { href: '' } }
};

const mockContext = { provider: 'bitbucket', authenticated: true, metadata: {} };

describe('CommitStatusHandler', () => {
  let handler: CommitStatusHandler;

  beforeEach(() => {
    handler = new CommitStatusHandler();
    jest.clearAllMocks();
  });

  it('should have event = "repo:commit_status_updated"', () => {
    expect(handler.event).toBe('repo:commit_status_updated');
  });

  describe('canHandle', () => {
    it('should return true when state is SUCCESSFUL', () => {
      expect(handler.canHandle?.(makePayload('SUCCESSFUL') as never, mockContext)).toBe(true);
    });

    it('should return false when state is not SUCCESSFUL', () => {
      expect(handler.canHandle?.(makePayload('FAILED') as never, mockContext)).toBe(false);
      expect(handler.canHandle?.(makePayload('INPROGRESS') as never, mockContext)).toBe(false);
    });
  });

  it('should return error when commit SHA cannot be extracted from links.commit.href', async () => {
    const badPayload = makePayload('SUCCESSFUL');
    (badPayload.data.commit_status as Record<string, unknown>)['links'] = {
      commit: { href: 'https://example.com/not-a-bitbucket-url' },
      self: { href: '' }
    };

    const result = await handler.handle(badPayload as never, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/commit SHA/);
    expect(bitbucketService.allStatusesSuccessful).not.toHaveBeenCalled();
  });

  it('should skip PR review when not all statuses are successful', async () => {
    (bitbucketService.allStatusesSuccessful as jest.Mock).mockResolvedValue(false);

    const result = await handler.handle(makePayload('SUCCESSFUL') as never, mockContext);

    expect(bitbucketService.findPRsForCommit).not.toHaveBeenCalled();
    expect(claudeService.processCommand).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('should skip PR review when no open PRs found', async () => {
    (bitbucketService.allStatusesSuccessful as jest.Mock).mockResolvedValue(true);
    (bitbucketService.findPRsForCommit as jest.Mock).mockResolvedValue([]);

    const result = await handler.handle(makePayload('SUCCESSFUL') as never, mockContext);

    expect(claudeService.processCommand).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('should trigger a PR review when all statuses pass and open PRs exist', async () => {
    (bitbucketService.allStatusesSuccessful as jest.Mock).mockResolvedValue(true);
    (bitbucketService.findPRsForCommit as jest.Mock).mockResolvedValue([mockOpenPR]);
    (claudeService.processCommand as jest.Mock).mockResolvedValue('Code review complete');
    (bitbucketService.postPRComment as jest.Mock).mockResolvedValue(undefined);

    const result = await handler.handle(makePayload('SUCCESSFUL') as never, mockContext);

    expect(claudeService.processCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        repoFullName: 'myws/my-repo',
        issueNumber: 8,
        isPullRequest: true,
        branchName: 'feature-y',
        operationType: 'pr-review',
        provider: 'bitbucket'
      })
    );
    expect(bitbucketService.postPRComment).toHaveBeenCalledWith(
      'myws',
      'my-repo',
      8,
      'Code review complete'
    );
    expect(result.success).toBe(true);
  });

  it('should handle individual PR review errors gracefully', async () => {
    (bitbucketService.allStatusesSuccessful as jest.Mock).mockResolvedValue(true);
    (bitbucketService.findPRsForCommit as jest.Mock).mockResolvedValue([mockOpenPR]);
    (claudeService.processCommand as jest.Mock).mockRejectedValue(new Error('Claude timeout'));
    (bitbucketService.postPRComment as jest.Mock).mockResolvedValue(undefined);

    const result = await handler.handle(makePayload('SUCCESSFUL') as never, mockContext);

    expect(result.success).toBe(false);
    expect(bitbucketService.postPRComment).toHaveBeenCalled();
  });
});
