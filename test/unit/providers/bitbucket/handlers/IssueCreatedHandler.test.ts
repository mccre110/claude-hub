import { IssueCreatedHandler } from '../../../../../src/providers/bitbucket/handlers/IssueCreatedHandler';
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

const mockPayload = {
  id: 'evt-1',
  timestamp: '',
  event: 'issue:created',
  source: 'bitbucket',
  bitbucketEvent: 'issue:created',
  data: {
    actor: { nickname: 'alice', display_name: 'Alice' },
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
      id: 42,
      title: 'Something is broken',
      content: { raw: 'Steps to reproduce: ...', markup: '', html: '' },
      state: 'new',
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
    }
  }
};

const mockContext = { provider: 'bitbucket', authenticated: true, metadata: {} };

describe('IssueCreatedHandler', () => {
  let handler: IssueCreatedHandler;

  beforeEach(() => {
    handler = new IssueCreatedHandler();
    jest.clearAllMocks();
  });

  it('should have event = "issue:created" and priority = 100', () => {
    expect(handler.event).toBe('issue:created');
    expect(handler.priority).toBe(100);
  });

  it('should call processCommand with auto-tagging operation and bitbucket provider', async () => {
    (claudeService.processCommand as jest.Mock).mockResolvedValue('Tagged successfully');

    const result = await handler.handle(mockPayload as never, mockContext);

    expect(claudeService.processCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        repoFullName: 'myws/my-repo',
        issueNumber: 42,
        operationType: 'auto-tagging',
        provider: 'bitbucket'
      })
    );
    expect(result.success).toBe(true);
  });

  it('should return failure and post fallback comment when processCommand throws', async () => {
    (claudeService.processCommand as jest.Mock).mockRejectedValue(new Error('Claude failed'));
    (bitbucketService.postIssueComment as jest.Mock).mockResolvedValue(undefined);

    const result = await handler.handle(mockPayload as never, mockContext);

    expect(result.success).toBe(false);
    expect(bitbucketService.postIssueComment).toHaveBeenCalled();
  });
});
