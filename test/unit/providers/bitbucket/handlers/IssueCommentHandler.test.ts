import { IssueCommentHandler } from '../../../../../src/providers/bitbucket/handlers/IssueCommentHandler';
import * as claudeService from '../../../../../src/services/claudeService';
import * as bitbucketService from '../../../../../src/services/bitbucketService';

jest.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
}));

jest.mock('../../../../../src/services/claudeService', () => ({
  processCommand: jest.fn()
}));

jest.mock('../../../../../src/services/bitbucketService', () => ({
  postIssueComment: jest.fn(),
  parseFullName: jest.fn((s: string) => {
    const [workspace, repoSlug] = s.split('/');
    return { workspace, repoSlug };
  })
}));

const BOT_USERNAME = '@ClaudeBot';

const makePayload = (commentBody: string, authorNickname = 'alice') => ({
  id: 'evt-2',
  timestamp: '',
  event: 'issue:comment_created',
  source: 'bitbucket',
  bitbucketEvent: 'issue:comment_created',
  data: {
    actor: { nickname: authorNickname },
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
    issue: {
      id: 7,
      title: 'Test Issue',
      content: { raw: '', markup: '', html: '' },
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
      type: 'issue',
      links: { self: { href: '' }, html: { href: '' } }
    },
    comment: {
      id: 1,
      content: { raw: commentBody, markup: '', html: '' },
      created_on: '',
      updated_on: '',
      author: {
        type: 'user',
        uuid: '{u}',
        nickname: authorNickname,
        display_name: 'Alice',
        links: { self: { href: '' } }
      },
      type: 'issue_comment',
      links: { self: { href: '' }, html: { href: '' } }
    }
  }
});

const mockContext = { provider: 'bitbucket', authenticated: true, metadata: {} };

describe('IssueCommentHandler', () => {
  let handler: IssueCommentHandler;
  const originalBotUsername = process.env['BOT_USERNAME'];

  beforeEach(() => {
    handler = new IssueCommentHandler();
    process.env['BOT_USERNAME'] = BOT_USERNAME;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env['BOT_USERNAME'] = originalBotUsername;
  });

  it('should have event = "issue:comment_created"', () => {
    expect(handler.event).toBe('issue:comment_created');
  });

  describe('canHandle', () => {
    it('should return true when comment mentions the bot', () => {
      const payload = makePayload(`Hey ${BOT_USERNAME} please fix this`);
      expect(handler.canHandle?.(payload as never, mockContext)).toBe(true);
    });

    it('should return false when comment does not mention the bot', () => {
      const payload = makePayload('Just a normal comment');
      expect(handler.canHandle?.(payload as never, mockContext)).toBe(false);
    });
  });

  it('should dispatch command and post the response', async () => {
    (claudeService.processCommand as jest.Mock).mockResolvedValue('Here is the fix');
    (bitbucketService.postIssueComment as jest.Mock).mockResolvedValue(undefined);

    const payload = makePayload(`${BOT_USERNAME} fix the bug`);
    const result = await handler.handle(payload as never, mockContext);

    expect(claudeService.processCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        repoFullName: 'myws/my-repo',
        issueNumber: 7,
        command: 'fix the bug',
        provider: 'bitbucket',
        operationType: 'default'
      })
    );
    expect(bitbucketService.postIssueComment).toHaveBeenCalledWith(
      'myws',
      'my-repo',
      7,
      'Here is the fix'
    );
    expect(result.success).toBe(true);
  });

  it('should ignore self-comments to prevent infinite loops', async () => {
    const payload = makePayload(`${BOT_USERNAME} do something`, BOT_USERNAME.replace(/^@/, ''));
    const result = await handler.handle(payload as never, mockContext);

    expect(claudeService.processCommand).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('should handle processCommand errors gracefully', async () => {
    (claudeService.processCommand as jest.Mock).mockRejectedValue(new Error('boom'));
    (bitbucketService.postIssueComment as jest.Mock).mockResolvedValue(undefined);

    const payload = makePayload(`${BOT_USERNAME} do something`);
    const result = await handler.handle(payload as never, mockContext);

    expect(result.success).toBe(false);
    expect(bitbucketService.postIssueComment).toHaveBeenCalled();
  });
});
