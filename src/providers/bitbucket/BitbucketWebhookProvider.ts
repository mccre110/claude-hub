import crypto from 'crypto';
import { createLogger } from '../../utils/logger';
import type { WebhookRequest } from '../../types/express';
import type { WebhookProvider } from '../../types/webhook';
import type {
  BitbucketWebhookEvent,
  BitbucketRepository,
  BitbucketUser
} from '../../types/bitbucket';

const logger = createLogger('BitbucketWebhookProvider');

/**
 * Bitbucket Cloud webhook provider implementation.
 *
 * Signature verification uses HMAC-SHA256 with the X-Hub-Signature header
 * (format: "sha256=<hex>"), which is identical to GitHub's X-Hub-Signature-256.
 *
 * Event type is taken directly from the X-Event-Key header
 * (e.g., "issue:created", "pullrequest:comment_created").
 */
export class BitbucketWebhookProvider implements WebhookProvider<BitbucketWebhookEvent> {
  readonly name = 'bitbucket';

  verifySignature(req: WebhookRequest, secret: string): Promise<boolean> {
    // eslint-disable-next-line no-sync
    return Promise.resolve(this.verifySignatureSync(req, secret));
  }

  private verifySignatureSync(req: WebhookRequest, secret: string): boolean {
    const signature = req.headers['x-hub-signature'] as string | undefined;
    if (!signature) {
      logger.warn('No X-Hub-Signature header found in Bitbucket webhook request');
      return false;
    }

    try {
      const payload = req.rawBody ?? JSON.stringify(req.body);
      const hmac = crypto.createHmac('sha256', secret);
      const calculatedSignature = 'sha256=' + hmac.update(payload).digest('hex');

      if (
        signature.length === calculatedSignature.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(calculatedSignature))
      ) {
        logger.debug('Bitbucket webhook signature verified successfully');
        return true;
      }

      logger.warn('Bitbucket webhook signature verification failed');
      return false;
    } catch (error) {
      logger.error({ err: error }, 'Error verifying Bitbucket webhook signature');
      return false;
    }
  }

  parsePayload(req: WebhookRequest): Promise<BitbucketWebhookEvent> {
    // eslint-disable-next-line no-sync
    return Promise.resolve(this.parsePayloadSync(req));
  }

  private parsePayloadSync(req: WebhookRequest): BitbucketWebhookEvent {
    const bitbucketEvent = (req.headers['x-event-key'] as string) ?? '';
    const hookUuid = req.headers['x-hook-uuid'] as string | undefined;
    const requestUuid = req.headers['x-request-uuid'] as string | undefined;
    const attemptNumberRaw = req.headers['x-attempt-number'] as string | undefined;
    const attemptNumber = attemptNumberRaw ? parseInt(attemptNumberRaw, 10) : undefined;
    const payload = req.body as unknown as Record<string, unknown>;

    const repository = payload['repository'] as BitbucketRepository | undefined;
    const actor =
      (payload['actor'] as BitbucketUser | undefined) ??
      (payload['pullrequest'] as { author?: BitbucketUser } | undefined)?.author ??
      undefined;

    // Use X-Request-UUID for idempotency (unique per delivery), fall back to X-Hook-UUID
    const id = requestUuid ?? hookUuid ?? crypto.randomUUID();

    return {
      id,
      timestamp: new Date().toISOString(),
      event: bitbucketEvent, // Already in "resource:action" format — no normalization needed
      source: 'bitbucket',
      bitbucketEvent,
      hookUuid,
      requestUuid,
      attemptNumber,
      repository,
      actor,
      data: payload
    };
  }

  getEventType(payload: BitbucketWebhookEvent): string {
    return payload.event;
  }

  getEventDescription(payload: BitbucketWebhookEvent): string {
    const parts = [payload.bitbucketEvent];
    if (payload.repository) {
      parts.push(`in ${payload.repository.full_name}`);
    }
    if (payload.actor) {
      parts.push(`by ${payload.actor.nickname}`);
    }
    return parts.join(' ');
  }
}
