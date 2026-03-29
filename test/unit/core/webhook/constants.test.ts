import {
  ALLOWED_WEBHOOK_PROVIDERS,
  isAllowedProvider
} from '../../../../src/core/webhook/constants';

describe('Webhook Constants', () => {
  describe('ALLOWED_WEBHOOK_PROVIDERS', () => {
    it('should contain github', () => {
      expect(ALLOWED_WEBHOOK_PROVIDERS).toContain('github');
    });

    it('should contain claude', () => {
      expect(ALLOWED_WEBHOOK_PROVIDERS).toContain('claude');
    });

    it('should contain bitbucket', () => {
      expect(ALLOWED_WEBHOOK_PROVIDERS).toContain('bitbucket');
    });

    it('should be a readonly array with expected providers', () => {
      // TypeScript's 'as const' makes it readonly at compile time
      // but not frozen at runtime
      expect(ALLOWED_WEBHOOK_PROVIDERS).toEqual(['github', 'claude', 'bitbucket']);
    });
  });

  describe('isAllowedProvider', () => {
    it('should return true for allowed providers', () => {
      expect(isAllowedProvider('github')).toBe(true);
      expect(isAllowedProvider('claude')).toBe(true);
      expect(isAllowedProvider('bitbucket')).toBe(true);
    });

    it('should return false for disallowed providers', () => {
      expect(isAllowedProvider('gitlab')).toBe(false);
      expect(isAllowedProvider('invalid')).toBe(false);
      expect(isAllowedProvider('')).toBe(false);
    });

    it('should be case sensitive', () => {
      expect(isAllowedProvider('GitHub')).toBe(false);
      expect(isAllowedProvider('GITHUB')).toBe(false);
    });
  });
});
