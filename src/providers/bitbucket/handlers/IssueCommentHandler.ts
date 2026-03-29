import { createLogger } from '../../../utils/logger';
import { processCommand } from '../../../services/claudeService';
import { postIssueComment, parseFullName } from '../../../services/bitbucketService';
import type {
  WebhookEventHandler,
  WebhookContext,
  WebhookHandlerResponse
} from '../../../types/webhook';
import type { BitbucketWebhookEvent, BitbucketIssueCommentPayload } from '../../../types/bitbucket';

const logger = createLogger('BitbucketIssueCommentHandler');

/**
 * Handles Bitbucket "issue:comment_created" events.
 *
 * Detects bot mentions in issue comments and dispatches the command to Claude.
 */
export class IssueCommentHandler implements WebhookEventHandler<BitbucketWebhookEvent> {
  event = 'issue:comment_created';
  priority = 100;

  canHandle(payload: BitbucketWebhookEvent): boolean {
    const botUsername = process.env['BOT_USERNAME'];
    const data = payload.data as BitbucketIssueCommentPayload;
    const commentBody = data?.comment?.content?.raw ?? '';
    return botUsername ? commentBody.includes(botUsername) : false;
  }

  async handle(
    payload: BitbucketWebhookEvent,
    context: WebhookContext
  ): Promise<WebhookHandlerResponse> {
    try {
      const botUsername = process.env['BOT_USERNAME'];
      const data = payload.data as BitbucketIssueCommentPayload;
      const { comment, issue, repository } = data;
      const { workspace, repoSlug } = parseFullName(repository.full_name);
      const commentBody = comment.content.raw;

      if (!botUsername) {
        logger.error('BOT_USERNAME is not configured — cannot detect bot mentions');
        return { success: false, error: 'BOT_USERNAME not configured' };
      }

      // Ignore comments authored by the bot itself to prevent loops
      if (comment.author.nickname === botUsername.replace(/^@/, '')) {
        logger.info('Ignoring comment authored by the bot itself');
        return { success: true, message: 'Ignored bot self-comment' };
      }

      const botMentionIndex = commentBody.indexOf(botUsername);
      if (botMentionIndex === -1) {
        return { success: true, message: 'No bot mention found in comment' };
      }

      const command = commentBody.slice(botMentionIndex + botUsername.length).trim();
      if (!command) {
        return { success: true, message: 'Bot mentioned but no command provided' };
      }

      logger.info(
        {
          repo: repository.full_name,
          issue: issue.id,
          author: comment.author.nickname,
          commandPreview: command.substring(0, 100)
        },
        'Dispatching Bitbucket issue comment command to Claude'
      );

      const response = await processCommand({
        repoFullName: repository.full_name,
        issueNumber: issue.id,
        command,
        isPullRequest: false,
        branchName: null,
        operationType: 'default',
        provider: 'bitbucket'
      });

      if (response) {
        await postIssueComment(workspace, repoSlug, issue.id, response);
      }

      return {
        success: true,
        message: 'Command processed successfully',
        data: { repo: repository.full_name, issue: issue.id }
      };
    } catch (error) {
      logger.error({ err: error, context }, 'Error processing Bitbucket issue comment');

      try {
        const data = payload.data as BitbucketIssueCommentPayload;
        const { workspace, repoSlug } = parseFullName(data.repository.full_name);
        await postIssueComment(
          workspace,
          repoSlug,
          data.issue.id,
          `_Sorry, I encountered an error processing your request. Please try again._`
        );
      } catch {
        // Ignore secondary failure
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process issue comment'
      };
    }
  }
}
