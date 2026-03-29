import { createLogger } from '../../../utils/logger';
import { processCommand } from '../../../services/claudeService';
import { postIssueComment, parseFullName } from '../../../services/bitbucketService';
import type {
  WebhookEventHandler,
  WebhookContext,
  WebhookHandlerResponse
} from '../../../types/webhook';
import type { BitbucketWebhookEvent, BitbucketIssueCreatedPayload } from '../../../types/bitbucket';

const logger = createLogger('BitbucketIssueCreatedHandler');

/**
 * Handles Bitbucket "issue:created" events.
 *
 * Triggers auto-tagging via Claude.  Bitbucket issues do not support arbitrary
 * labels, so Claude is instructed to use `bkt issue edit` to set the structured
 * kind/priority fields instead.  If Claude fails, a simple fallback that posts
 * a comment with the classification is applied.
 */
export class IssueCreatedHandler implements WebhookEventHandler<BitbucketWebhookEvent> {
  event = 'issue:created';
  priority = 100;

  async handle(
    payload: BitbucketWebhookEvent,
    context: WebhookContext
  ): Promise<WebhookHandlerResponse> {
    try {
      const data = payload.data as BitbucketIssueCreatedPayload;
      const { issue, repository } = data;
      parseFullName(repository.full_name); // validates format; workspace/repoSlug used in fallback

      logger.info(
        {
          repo: repository.full_name,
          issue: issue.id,
          title: issue.title,
          reporter: issue.reporter.nickname
        },
        'Processing new Bitbucket issue for auto-tagging'
      );

      const tagCommand = `Analyze this Bitbucket issue and set appropriate fields using the bkt CLI.

Issue Details:
- Title: ${issue.title}
- Description: ${issue.content.raw || 'No description provided'}
- Issue Number: ${issue.id}
- Repository: ${repository.full_name}

Instructions:
1. Analyze the issue content to determine the appropriate classification.
2. Set the issue kind using: bkt issue edit ${issue.id} --kind <bug|enhancement|proposal|task>
3. Set the priority using: bkt issue edit ${issue.id} --priority <trivial|minor|major|critical|blocker>
4. If applicable, set the component using: bkt issue edit ${issue.id} --component <component-name>
5. Do NOT comment on the issue - only update the fields silently.

Complete the auto-tagging task using only bkt CLI commands.`;

      await processCommand({
        repoFullName: repository.full_name,
        issueNumber: issue.id,
        command: tagCommand,
        isPullRequest: false,
        branchName: null,
        operationType: 'auto-tagging',
        provider: 'bitbucket'
      });

      return {
        success: true,
        message: 'Bitbucket issue auto-tagged successfully',
        data: { repo: repository.full_name, issue: issue.id }
      };
    } catch (error) {
      logger.error({ err: error, context }, 'Error processing Bitbucket issue for auto-tagging');

      // Best-effort fallback: post a comment with manual classification guidance
      try {
        const data = payload.data as BitbucketIssueCreatedPayload;
        const { workspace, repoSlug } = parseFullName(data.repository.full_name);
        await postIssueComment(
          workspace,
          repoSlug,
          data.issue.id,
          '_Auto-tagging encountered an error. Please set the issue kind and priority manually._'
        );
      } catch {
        // Ignore secondary failure
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to auto-tag Bitbucket issue'
      };
    }
  }
}
