import { Logger } from '@nestjs/common';
import { getConfig } from '../config';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushFailure {
  code: string;
  message: string;
}

export interface PushResult {
  invalidTokens: string[];
  failures: PushFailure[];
}

export abstract class PushService {
  abstract send(
    tokens: string[],
    payload: PushPayload,
  ): Promise<PushResult>;
}

export class LogPushService extends PushService {
  async send(
    tokens: string[],
    p: PushPayload,
  ): Promise<PushResult> {
    if (process.env.NODE_ENV !== 'test') {
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'push_skipped_no_fcm',
          devices: tokens.length,
          title: p.title,
        }),
      );
    }

    return {
      invalidTokens: [],
      failures: [],
    };
  }
}

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

interface FcmMessaging {
  sendEachForMulticast(input: {
    tokens: string[];
    notification: {
      title: string;
      body: string;
    };
    data: Record<string, string>;
    apns: {
      payload: {
        aps: {
          sound: string;
        };
      };
    };
  }): Promise<{
    responses: Array<{
      success: boolean;
      error?: {
        code?: string;
        message?: string;
      };
    }>;
  }>;
}

export class FcmPushService extends PushService {
  private messaging?: Promise<FcmMessaging>;

  constructor(
    private serviceAccountBase64: string,
    private readonly messagingFactory?: () => Promise<FcmMessaging>,
  ) {
    super();
  }

  private getMessaging(): Promise<FcmMessaging> {
    return (this.messaging ??= this.messagingFactory
      ? this.messagingFactory()
      : this.createFirebaseMessaging());
  }

  private async createFirebaseMessaging(): Promise<FcmMessaging> {
    const mod: any = await import('firebase-admin');
    const admin = mod.default ?? mod;

    const credentials = JSON.parse(
      Buffer.from(
        this.serviceAccountBase64,
        'base64',
      ).toString('utf8'),
    );

    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert(credentials),
        });

    return admin.messaging(app) as FcmMessaging;
  }

  async send(
    tokens: string[],
    p: PushPayload,
  ): Promise<PushResult> {
    if (!tokens.length) {
      return {
        invalidTokens: [],
        failures: [],
      };
    }

    const res = await (
      await this.getMessaging()
    ).sendEachForMulticast({
      tokens,
      notification: {
        title: p.title,
        body: p.body,
      },
      data: p.data ?? {},
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });

    const invalidTokens: string[] = [];
    const failures: PushFailure[] = [];

    res.responses.forEach((response, index) => {
      if (response.success) {
        return;
      }

      const code =
        response.error?.code ?? 'unknown';

      const message =
        response.error?.message ??
        'Push delivery failed';

      if (DEAD_TOKEN_CODES.has(code)) {
        invalidTokens.push(tokens[index]);
        return;
      }

      failures.push({
        code,
        message,
      });
    });

    return {
      invalidTokens,
      failures,
    };
  }
}

export function createPushService(): PushService {
  const cfg = getConfig();

  if (cfg.firebaseServiceAccountBase64) {
    return new FcmPushService(
      cfg.firebaseServiceAccountBase64,
    );
  }

  if (cfg.nodeEnv === 'production') {
    new Logger('Push').warn(
      'FIREBASE_SERVICE_ACCOUNT_BASE64 not set — push notifications are disabled',
    );
  }

  return new LogPushService();
}
