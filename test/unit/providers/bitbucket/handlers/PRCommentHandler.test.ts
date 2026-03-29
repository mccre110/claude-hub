import { PRCommentHandler } from '../../../../../src/providers/bitbucket/handlers/PRCommentHandler';
import * as claudeService from '../../../../../src/services/claudeService';
import * as bitbucketService from '../../../../../src/services/bitbucketService';

jest.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
}));

jest.mock('../../../../../src/services/claudeService', () => ({
  processCommand: jest.fn()
}));

jest.mock('../../../../../src/services/bitbucketService', () => ({
  postPRComment: jest.fn(),
  parseFullName: jest.fn((s: string) => {
    const [workspace, repoSlug] = s.split('/');
    return { workspace, repoSlug };
  })
}));

const BOT_USERNAME = '@ClaudeBot';

const makePayload = (commentBody: string, authorNickname = 'alice') => ({
  id: 'evt-3',
  timestamp: '',
  event: 'pullrequest:comment_created',
  source: 'bitbucket',
  bitbucketEvent: 'pullrequest:comment_created',
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
    pullrequest: {
      id: 5,
      title: 'Add feature X',
      description: '',
      state: 'OPEN',
      author: {
        type: 'user',
        uuid: '{u}',
        nickname: authorNickname,
        display_name: 'Alice',
        links: { self: { href: '' } }
      },
      source: {
        branch: { name: 'feature-x' },
        commit: { hash: 'abc123', type: 'commit' },
        repository: {} as never
      },
      destination: {
        branch: { name: 'main' },
        commit: { hash: 'def456', type: 'commit' },
        repository: {} as never
      },
      reviewers: [],
      participants: [],
      created_on: '',
      updated_on: '',
      type: 'pullrequest',
      links: { self: { href: '' }, html: { href: '' }, commits: { href: '' } }
    },
    comment: {
      id: 10,
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
      type: 'pullrequest_comment',
      links: { self: { href: '' }, html: { href: '' } }
    }
  }
});

const mockContext = { provider: 'bitbucket', authenticated: true, metadata: {} };

describe('PRCommentHandler', () => {
  let handler: PRCommentHandler;
  const originalBotUsername = process.env['BOT_USERNAME'];

  beforeEach(() => {
    handler = new PRCommentHandler();
    process.env['BOT_USERNAME'] = BOT_USERNAME;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env['BOT_USERNAME'] = originalBotUsername;
  });

  it('should have event = "pullrequest:comment_created"', () => {
    expect(handler.event).toBe('pullrequest:comment_created');
  });

  it('should dispatch command with isPullRequest=true and branchName set', async () => {
    (claudeService.processCommand as jest.Mock).mockResolvedValue('LGTM!');
    (bitbucketService.postPRComment as jest.Mock).mockResolvedValue(undefined);

    const payload = makePayload(`${BOT_USERNAME} review this`);
    const result = await handler.handle(payload as never, mockContext);

    expect(claudeService.processCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        repoFullName: 'myws/my-repo',
        issueNumber: 5,
        command: 'review this',
        isPullRequest: true,
        branchName: 'feature-x',
        provider: 'bitbucket'
      })
    );
    expect(bitbucketService.postPRComment).toHaveBeenCalledWith('myws', 'my-repo', 5, 'LGTM!');
    expect(result.success).toBe(true);
  });

  it('should ignore bot self-comments', async () => {
    const payload = makePayload(`${BOT_USERNAME} do something`, BOT_USERNAME.replace(/^@/, ''));
    const result = await handler.handle(payload as never, mockContext);

    expect(claudeService.processCommand).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
