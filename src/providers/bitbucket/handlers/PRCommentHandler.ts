import { createLogger } from '../../../utils/logger';
import { processCommand } from '../../../services/claudeService';
import { postPRComment, parseFullName } from '../../../services/bitbucketService';
import type {
  WebhookEventHandler,
  WebhookContext,
  WebhookHandlerResponse
} from '../../../types/webhook';
import type { BitbucketWebhookEvent, BitbucketPRCommentPayload } from '../../../types/bitbucket';

const logger = createLogger('BitbucketPRCommentHandler');

/**
 * Handles Bitbucket "pullrequest:comment_created" events.
 *
 * Detects bot mentions in PR comments and dispatches the command to Claude.
 */
export class PRCommentHandler implements WebhookEventHandler<BitbucketWebhookEvent> {
  event = 'pullrequest:comment_created';
  priority = 100;

  canHandle(payload: BitbucketWebhookEvent): boolean {
    const botUsername = process.env['BOT_USERNAME'];
    const data = payload.data as BitbucketPRCommentPayload;
    const commentBody = data?.comment?.content?.raw ?? '';
    return botUsername ? commentBody.includes(botUsername) : false;
  }

  async handle(
    payload: BitbucketWebhookEvent,
    context: WebhookContext
  ): Promise<WebhookHandlerResponse> {
    try {
      const botUsername = process.env['BOT_USERNAME'];
      const data = payload.data as BitbucketPRCommentPayload;
      const { comment, pullrequest, repository } = data;
      const { workspace, repoSlug } = parseFullName(repository.full_name);
      const commentBody = comment.content.raw;

      if (!botUsername) {
        logger.error('BOT_USERNAME is not configured — cannot detect bot mentions');
        return { success: false, error: 'BOT_USERNAME not configured' };
      }

      // Ignore comments authored by the bot itself to prevent loops
      if (comment.author.nickname === botUsername.replace(/^@/, '')) {
        logger.info('Ignoring PR comment authored by the bot itself');
        return { success: true, message: 'Ignored bot self-comment' };
      }

      const botMentionIndex = commentBody.indexOf(botUsername);
      if (botMentionIndex === -1) {
        return { success: true, message: 'No bot mention found in PR comment' };
      }

      const command = commentBody.slice(botMentionIndex + botUsername.length).trim();
      if (!command) {
        return { success: true, message: 'Bot mentioned but no command provided' };
      }

      const sourceBranch = pullrequest.source.branch.name;

      logger.info(
        {
          repo: repository.full_name,
          pr: pullrequest.id,
          author: comment.author.nickname,
          branch: sourceBranch,
          commandPreview: command.substring(0, 100)
        },
        'Dispatching Bitbucket PR comment command to Claude'
      );

      const response = await processCommand({
        repoFullName: repository.full_name,
        issueNumber: pullrequest.id,
        command,
        isPullRequest: true,
        branchName: sourceBranch,
        operationType: 'default',
        provider: 'bitbucket'
      });

      if (response) {
        await postPRComment(workspace, repoSlug, pullrequest.id, response);
      }

      return {
        success: true,
        message: 'PR comment command processed successfully',
        data: { repo: repository.full_name, pr: pullrequest.id }
      };
    } catch (error) {
      logger.error({ err: error, context }, 'Error processing Bitbucket PR comment');

      try {
        const data = payload.data as BitbucketPRCommentPayload;
        const { workspace, repoSlug } = parseFullName(data.repository.full_name);
        await postPRComment(
          workspace,
          repoSlug,
          data.pullrequest.id,
          `_Sorry, I encountered an error processing your request. Please try again._`
        );
      } catch {
        // Ignore secondary failure
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process PR comment'
      };
    }
  }
}
