import {
  parseFullName,
  postPRComment,
  postIssueComment,
  getCommitStatuses,
  allStatusesSuccessful,
  getPullRequestDetails,
  findPRsForCommit,
  getIssue,
  updateIssueFields
} from '../../../src/services/bitbucketService';
import { extractCommitShaFromHref } from '../../../src/types/bitbucket';

jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../../src/utils/secureCredentials', () => ({
  __esModule: true,
  default: { get: jest.fn().mockReturnValue('fake-bb-token') }
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const jsonOk = (data: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  }) as unknown as Response;

const jsonError = (status: number, statusText: string): Response =>
  ({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({ error: { message: statusText } }),
    text: () => Promise.resolve(statusText)
  }) as unknown as Response;

// Minimal fake commit status as returned by the REST API (no commit.hash!)
const makeApiStatus = (state: string) => ({
  state,
  key: 'ci',
  url: 'https://ci.example.com',
  type: 'build',
  created_on: '2024-01-01T00:00:00Z',
  updated_on: '2024-01-01T00:01:00Z',
  links: {
    commit: { href: 'https://api.bitbucket.org/2.0/repositories/myws/my-repo/commit/abc123' },
    self: {
      href: 'https://api.bitbucket.org/2.0/repositories/myws/my-repo/commit/statuses/build/ci'
    }
  }
});

const fakeIssue = {
  type: 'issue',
  id: 7,
  title: 'Test issue',
  content: { raw: 'desc', markup: 'markdown', html: '<p>desc</p>' },
  state: 'open',
  kind: 'bug',
  priority: 'major',
  reporter: {
    type: 'user',
    uuid: '{u}',
    nickname: 'alice',
    display_name: 'Alice',
    links: { self: { href: '' } }
  },
  created_on: '',
  updated_on: '',
  links: { self: { href: '' }, html: { href: '' } }
};

describe('bitbucketService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env['BITBUCKET_AUTH_MODE'];
    delete process.env['BITBUCKET_USERNAME'];
  });

  // ─── extractCommitShaFromHref (type helper) ───────────────────────────────

  describe('extractCommitShaFromHref', () => {
    it('should extract SHA from a standard Bitbucket commit API URL', () => {
      const href =
        'https://api.bitbucket.org/2.0/repositories/ws/repo/commit/9fec847784abb10b2fa567ee63b85bd238955d0e';
      expect(extractCommitShaFromHref(href)).toBe('9fec847784abb10b2fa567ee63b85bd238955d0e');
    });

    it('should extract short SHA', () => {
      expect(
        extractCommitShaFromHref('https://api.bitbucket.org/2.0/repositories/ws/repo/commit/abc123')
      ).toBe('abc123');
    });

    it('should return null for an unrecognised URL', () => {
      expect(extractCommitShaFromHref('https://example.com/not-a-commit-url')).toBeNull();
    });

    it('should handle trailing slash', () => {
      expect(
        extractCommitShaFromHref(
          'https://api.bitbucket.org/2.0/repositories/ws/repo/commit/abc123/'
        )
      ).toBe('abc123');
    });
  });

  // ─── parseFullName ────────────────────────────────────────────────────────

  describe('parseFullName', () => {
    it('should split workspace and repo slug', () => {
      expect(parseFullName('myworkspace/my-repo')).toEqual({
        workspace: 'myworkspace',
        repoSlug: 'my-repo'
      });
    });

    it('should handle workspace with hyphens and repo slug with hyphens', () => {
      expect(parseFullName('my-workspace/my-cool-repo')).toEqual({
        workspace: 'my-workspace',
        repoSlug: 'my-cool-repo'
      });
    });

    it('should throw for a value with no slash', () => {
      expect(() => parseFullName('no-slash')).toThrow('Invalid Bitbucket repository full_name');
    });

    it('should throw for an empty string', () => {
      expect(() => parseFullName('')).toThrow('Invalid Bitbucket repository full_name');
    });
  });

  // ─── Authentication headers ───────────────────────────────────────────────

  describe('authentication', () => {
    it('should use Bearer token by default', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk({ id: 99 }, 201));
      await postPRComment('myws', 'my-repo', 5, 'Hello');

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders.Authorization).toBe('Bearer fake-bb-token');
    });

    it('should use Basic auth when BITBUCKET_AUTH_MODE=basic', async () => {
      process.env['BITBUCKET_AUTH_MODE'] = 'basic';
      process.env['BITBUCKET_USERNAME'] = 'alice';

      mockFetch.mockResolvedValueOnce(jsonOk({ id: 99 }, 201));
      await postPRComment('myws', 'my-repo', 5, 'Hello');

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      const expected = `Basic ${Buffer.from('alice:fake-bb-token').toString('base64')}`;
      expect(callHeaders.Authorization).toBe(expected);
    });

    it('should throw when BITBUCKET_AUTH_MODE=basic but BITBUCKET_USERNAME is missing', async () => {
      process.env['BITBUCKET_AUTH_MODE'] = 'basic';
      // BITBUCKET_USERNAME not set

      await expect(postPRComment('myws', 'my-repo', 5, 'Hello')).rejects.toThrow(
        'BITBUCKET_USERNAME is required'
      );
    });
  });

  // ─── postPRComment ────────────────────────────────────────────────────────

  describe('postPRComment', () => {
    it('should POST to the correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk({ id: 99 }, 201));

      await postPRComment('myws', 'my-repo', 5, 'Great work!');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/myws/my-repo/pullrequests/5/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: { raw: 'Great work!' } })
        })
      );
    });
  });

  // ─── postIssueComment ────────────────────────────────────────────────────

  describe('postIssueComment', () => {
    it('should POST to the correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk({ id: 50 }, 201));

      await postIssueComment('myws', 'my-repo', 7, 'Issue resolved');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/myws/my-repo/issues/7/comments',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  // ─── getIssue ─────────────────────────────────────────────────────────────

  describe('getIssue', () => {
    it('should GET the correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk(fakeIssue));

      const result = await getIssue('myws', 'my-repo', 7);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/myws/my-repo/issues/7',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' })
        })
      );
      expect(result.id).toBe(7);
    });
  });

  // ─── updateIssueFields ───────────────────────────────────────────────────

  describe('updateIssueFields', () => {
    it('should GET current issue then PUT merged data', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonOk(fakeIssue)) // GET current issue
        .mockResolvedValueOnce(jsonOk(fakeIssue)); // PUT updated issue

      await updateIssueFields('myws', 'my-repo', 7, { priority: 'critical' });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const putCall = mockFetch.mock.calls[1];
      expect(putCall[0]).toBe('https://api.bitbucket.org/2.0/repositories/myws/my-repo/issues/7');
      const body = JSON.parse(putCall[1].body);
      // Should merge: keep existing kind, use new priority, preserve title and state
      expect(body.priority).toBe('critical');
      expect(body.kind).toBe('bug'); // preserved from fakeIssue
      expect(body.title).toBe('Test issue'); // preserved
      expect(body.state).toBe('open'); // preserved
    });
  });

  // ─── getCommitStatuses ───────────────────────────────────────────────────

  describe('getCommitStatuses', () => {
    it('should return the values array from the API response', async () => {
      const fakeStatuses = [makeApiStatus('SUCCESSFUL')];
      mockFetch.mockResolvedValueOnce(jsonOk({ values: fakeStatuses }));

      const result = await getCommitStatuses('myws', 'my-repo', 'abc123');
      expect(result).toEqual(fakeStatuses);
    });
  });

  // ─── allStatusesSuccessful ───────────────────────────────────────────────

  describe('allStatusesSuccessful', () => {
    it('should return false when there are no statuses', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk({ values: [] }));
      expect(await allStatusesSuccessful('myws', 'my-repo', 'abc')).toBe(false);
    });

    it('should return true when all statuses are SUCCESSFUL', async () => {
      mockFetch.mockResolvedValueOnce(jsonOk({ values: [makeApiStatus('SUCCESSFUL')] }));
      expect(await allStatusesSuccessful('myws', 'my-repo', 'abc')).toBe(true);
    });

    it('should return false when any status is not SUCCESSFUL', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonOk({
          values: [makeApiStatus('SUCCESSFUL'), makeApiStatus('FAILED')]
        })
      );
      expect(await allStatusesSuccessful('myws', 'my-repo', 'abc')).toBe(false);
    });
  });

  // ─── getPullRequestDetails ───────────────────────────────────────────────

  describe('getPullRequestDetails', () => {
    it('should throw on non-OK API responses', async () => {
      mockFetch.mockResolvedValueOnce(jsonError(404, 'Not Found'));
      await expect(getPullRequestDetails('myws', 'my-repo', 99)).rejects.toThrow(
        'Bitbucket API error 404'
      );
    });
  });

  // ─── findPRsForCommit ────────────────────────────────────────────────────

  describe('findPRsForCommit', () => {
    it('should return only OPEN PRs', async () => {
      const openPR = { id: 1, state: 'OPEN', title: 'Open PR' };
      const mergedPR = { id: 2, state: 'MERGED', title: 'Merged PR' };
      mockFetch.mockResolvedValueOnce(jsonOk({ values: [openPR, mergedPR] }));

      const result = await findPRsForCommit('myws', 'my-repo', 'abc');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('should return an empty list when the API call fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      const result = await findPRsForCommit('myws', 'my-repo', 'abc');
      expect(result).toEqual([]);
    });
  });
});
