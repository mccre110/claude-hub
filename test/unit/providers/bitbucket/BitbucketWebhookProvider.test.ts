import crypto from 'crypto';
import type { Request } from 'express';
import { BitbucketWebhookProvider } from '../../../../src/providers/bitbucket/BitbucketWebhookProvider';
import type { BitbucketRepository, BitbucketUser } from '../../../../src/types/bitbucket';

jest.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockRepo: BitbucketRepository = {
  type: 'repository',
  uuid: '{repo-uuid}',
  name: 'my-repo',
  full_name: 'myworkspace/my-repo',
  is_private: false,
  owner: {
    type: 'user',
    uuid: '{user-uuid}',
    nickname: 'alice',
    display_name: 'Alice',
    links: { self: { href: 'https://api.bitbucket.org/2.0/users/alice' } }
  },
  links: {
    self: { href: 'https://api.bitbucket.org/2.0/repositories/myworkspace/my-repo' },
    html: { href: 'https://bitbucket.org/myworkspace/my-repo' }
  }
};

const mockActor: BitbucketUser = {
  type: 'user',
  uuid: '{actor-uuid}',
  nickname: 'bob',
  display_name: 'Bob',
  links: { self: { href: 'https://api.bitbucket.org/2.0/users/bob' } }
};

describe('BitbucketWebhookProvider', () => {
  let provider: BitbucketWebhookProvider;
  let mockReq: Partial<Request>;

  beforeEach(() => {
    provider = new BitbucketWebhookProvider();
    mockReq = { headers: {}, body: {}, rawBody: '' };
  });

  describe('name', () => {
    it('should be "bitbucket"', () => {
      expect(provider.name).toBe('bitbucket');
    });
  });

  describe('verifySignature', () => {
    it('should verify a valid HMAC-SHA256 signature', async () => {
      const secret = 'my-secret';
      const payload = '{"actor":{"nickname":"bob"}}';
      const hmac = crypto.createHmac('sha256', secret);
      const signature = 'sha256=' + hmac.update(payload).digest('hex');

      mockReq.headers = { 'x-hub-signature': signature };
      mockReq.rawBody = payload;

      const result = await provider.verifySignature(mockReq as Request, secret);
      expect(result).toBe(true);
    });

    it('should reject an invalid signature', async () => {
      mockReq.headers = { 'x-hub-signature': 'sha256=deadbeef' };
      mockReq.rawBody = '{"actor":{"nickname":"bob"}}';

      const result = await provider.verifySignature(mockReq as Request, 'my-secret');
      expect(result).toBe(false);
    });

    it('should reject a missing signature header', async () => {
      mockReq.headers = {};
      mockReq.rawBody = '{"actor":{"nickname":"bob"}}';

      const result = await provider.verifySignature(mockReq as Request, 'my-secret');
      expect(result).toBe(false);
    });

    it('should fall back to JSON.stringify(body) when rawBody is missing', async () => {
      const secret = 'my-secret';
      const body = { actor: { nickname: 'bob' } };
      const payloadStr = JSON.stringify(body);
      const hmac = crypto.createHmac('sha256', secret);
      const signature = 'sha256=' + hmac.update(payloadStr).digest('hex');

      mockReq.headers = { 'x-hub-signature': signature };
      mockReq.body = body;
      mockReq.rawBody = undefined;

      const result = await provider.verifySignature(mockReq as Request, secret);
      expect(result).toBe(true);
    });
  });

  describe('parsePayload', () => {
    it('should parse an issue:created event', async () => {
      const payload = { actor: mockActor, repository: mockRepo, issue: { id: 1, title: 'Bug' } };

      mockReq.headers = {
        'x-event-key': 'issue:created',
        'x-hook-uuid': 'hook-uuid-123'
      };
      mockReq.body = payload;

      const result = await provider.parsePayload(mockReq as Request);

      expect(result).toMatchObject({
        id: 'hook-uuid-123',
        source: 'bitbucket',
        event: 'issue:created',
        bitbucketEvent: 'issue:created',
        hookUuid: 'hook-uuid-123',
        repository: mockRepo,
        actor: mockActor,
        data: payload
      });
      expect(result.timestamp).toBeDefined();
    });

    it('should generate a UUID when X-Hook-UUID is absent', async () => {
      mockReq.headers = { 'x-event-key': 'pullrequest:comment_created' };
      mockReq.body = {};

      const result = await provider.parsePayload(mockReq as Request);
      expect(result.id).toBeDefined();
      expect(result.id).not.toBe('');
    });

    it('should handle an empty X-Event-Key', async () => {
      mockReq.headers = {};
      mockReq.body = {};

      const result = await provider.parsePayload(mockReq as Request);
      expect(result.event).toBe('');
      expect(result.bitbucketEvent).toBe('');
    });
  });

  describe('getEventType', () => {
    it('should return the event field unchanged', () => {
      const payload = {
        id: '1',
        timestamp: '',
        event: 'repo:commit_status_updated',
        source: 'bitbucket',
        bitbucketEvent: 'repo:commit_status_updated',
        data: {}
      };
      expect(provider.getEventType(payload)).toBe('repo:commit_status_updated');
    });
  });

  describe('getEventDescription', () => {
    it('should compose a description with repo and actor', () => {
      const payload = {
        id: '1',
        timestamp: '',
        event: 'issue:created',
        source: 'bitbucket',
        bitbucketEvent: 'issue:created',
        repository: mockRepo,
        actor: mockActor,
        data: {}
      };
      expect(provider.getEventDescription(payload)).toBe(
        'issue:created in myworkspace/my-repo by bob'
      );
    });

    it('should handle missing optional fields', () => {
      const payload = {
        id: '1',
        timestamp: '',
        event: 'issue:created',
        source: 'bitbucket',
        bitbucketEvent: 'issue:created',
        data: {}
      };
      expect(provider.getEventDescription(payload)).toBe('issue:created');
    });
  });
});
