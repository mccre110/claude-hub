import { createLogger } from '../../../utils/logger';
import { processCommand } from '../../../services/claudeService';
import {
  allStatusesSuccessful,
  findPRsForCommit,
  postPRComment,
  parseFullName
} from '../../../services/bitbucketService';
import type {
  WebhookEventHandler,
  WebhookContext,
  WebhookHandlerResponse
} from '../../../types/webhook';
import type { BitbucketWebhookEvent, BitbucketCommitStatusPayload } from '../../../types/bitbucket';
import { extractCommitShaFromHref } from '../../../types/bitbucket';

const logger = createLogger('BitbucketCommitStatusHandler');

/**
 * Handles Bitbucket "repo:commit_status_updated" events.
 *
 * When a commit status transitions to SUCCESSFUL and all other statuses for
 * that commit are also successful, triggers an automated PR review for any
 * open PRs whose source commit matches.
 *
 * This mirrors the GitHub check_suite.completed → PR review flow.
 */
export class CommitStatusHandler implements WebhookEventHandler<BitbucketWebhookEvent> {
  event = 'repo:commit_status_updated';
  priority = 100;

  canHandle(payload: BitbucketWebhookEvent): boolean {
    const data = payload.data as BitbucketCommitStatusPayload;
    return data?.commit_status?.state === 'SUCCESSFUL';
  }

  async handle(
    payload: BitbucketWebhookEvent,
    context: WebhookContext
  ): Promise<WebhookHandlerResponse> {
    const data = payload.data as BitbucketCommitStatusPayload;
    const { commit_status: commitStatus, repository } = data;

    // The webhook payload does NOT include commit.hash directly.
    // The commit SHA must be extracted from links.commit.href:
    //   https://api.bitbucket.org/2.0/repositories/{ws}/{repo}/commit/{sha}
    const commitSha = extractCommitShaFromHref(commitStatus.links.commit.href);
    if (!commitSha) {
      logger.error(
        { href: commitStatus.links.commit.href },
        'Could not extract commit SHA from commit status links — skipping'
      );
      return { success: false, error: 'Could not determine commit SHA from payload' };
    }

    const { workspace, repoSlug } = parseFullName(repository.full_name);

    logger.info(
      { repo: repository.full_name, commitSha, statusKey: commitStatus.key },
      'Commit status updated to SUCCESSFUL; checking if all statuses pass'
    );

    try {
      const allPass = await allStatusesSuccessful(workspace, repoSlug, commitSha);
      if (!allPass) {
        logger.info(
          { commitSha },
          'Not all commit statuses are successful yet; skipping PR review'
        );
        return {
          success: true,
          message: 'Not all statuses successful; skipping PR review'
        };
      }

      const prs = await findPRsForCommit(workspace, repoSlug, commitSha);
      if (prs.length === 0) {
        logger.info({ commitSha }, 'No open PRs found for this commit; skipping PR review');
        return { success: true, message: 'No open PRs for commit' };
      }

      const results: WebhookHandlerResponse[] = [];

      for (const pr of prs) {
        logger.info(
          { repo: repository.full_name, pr: pr.id, branch: pr.source.branch.name },
          'Triggering automated PR review'
        );

        try {
          const reviewCommand = `Please perform a comprehensive code review for pull request #${pr.id} in ${repository.full_name}.

Review the following aspects:
1. **Security**: Check for vulnerabilities, injection risks, improper auth/authz, secrets exposure
2. **Logic**: Verify correctness, edge cases, error handling, and business logic
3. **Performance**: Identify potential bottlenecks, inefficient queries, or memory issues
4. **Code Quality**: Assess readability, maintainability, adherence to project conventions
5. **Testing**: Check test coverage and quality of existing tests

After your analysis:
- Post a detailed review comment using: bkt pr comment ${pr.id} "your review"
- If changes are needed, clearly list them
- If the code looks good, say so explicitly

Repository: ${repository.full_name}
PR Branch: ${pr.source.branch.name}
Commit: ${commitSha}`;

          const response = await processCommand({
            repoFullName: repository.full_name,
            issueNumber: pr.id,
            command: reviewCommand,
            isPullRequest: true,
            branchName: pr.source.branch.name,
            operationType: 'pr-review',
            provider: 'bitbucket'
          });

          if (response) {
            await postPRComment(workspace, repoSlug, pr.id, response);
          }

          results.push({
            success: true,
            message: `PR review completed for #${pr.id}`,
            data: { pr: pr.id }
          });
        } catch (prError) {
          logger.error({ err: prError, pr: pr.id }, 'Error reviewing PR');

          try {
            await postPRComment(
              workspace,
              repoSlug,
              pr.id,
              '_Automated PR review encountered an error. Please trigger a manual review._'
            );
          } catch {
            // Ignore
          }

          results.push({
            success: false,
            error: prError instanceof Error ? prError.message : 'Failed to review PR'
          });
        }
      }

      const allSucceeded = results.every(r => r.success);
      return {
        success: allSucceeded,
        message: `Processed ${results.length} PR review(s)`,
        data: { results }
      };
    } catch (error) {
      logger.error({ err: error, context }, 'Error in CommitStatusHandler');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process commit status'
      };
    }
  }
}
