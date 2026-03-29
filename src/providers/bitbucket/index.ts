import { webhookRegistry } from '../../core/webhook/WebhookRegistry';
import { BitbucketWebhookProvider } from './BitbucketWebhookProvider';
import { IssueCreatedHandler } from './handlers/IssueCreatedHandler';
import { IssueCommentHandler } from './handlers/IssueCommentHandler';
import { PRCommentHandler } from './handlers/PRCommentHandler';
import { CommitStatusHandler } from './handlers/CommitStatusHandler';
import { createLogger } from '../../utils/logger';

const logger = createLogger('BitbucketProvider');

/**
 * Initialize Bitbucket webhook provider and event handlers.
 */
export function initializeBitbucketProvider(): void {
  logger.info('Initializing Bitbucket webhook provider');

  const provider = new BitbucketWebhookProvider();
  webhookRegistry.registerProvider(provider);

  webhookRegistry.registerHandler('bitbucket', new IssueCreatedHandler());
  webhookRegistry.registerHandler('bitbucket', new IssueCommentHandler());
  webhookRegistry.registerHandler('bitbucket', new PRCommentHandler());
  webhookRegistry.registerHandler('bitbucket', new CommitStatusHandler());

  logger.info('Bitbucket webhook provider initialized with handlers');
}

// Auto-initialize when imported
initializeBitbucketProvider();
