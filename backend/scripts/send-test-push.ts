/// <reference types="node" />


import 'dotenv/config';

import { FcmPushService } from '../src/notifications/push.service';

const token = process.argv[2];
const credentials =
  process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

if (!token || !credentials) {
  console.error(
    'Usage: FIREBASE_SERVICE_ACCOUNT_BASE64=<base64-service-account-json> npx ts-node scripts/send-test-push.ts <device-token>',
  );
  process.exit(1);
}

const pushService = new FcmPushService(credentials);

async function main(): Promise<void> {
  try {
    const result = await pushService.send(
      [token],
      {
        title: 'CivicLens test',
        body: 'If you can read this, push notifications work.',
        data: {
          type: 'TEST',
        },
      },
    );

    if (result.failures.length > 0) {
      console.error('FCM delivery failed:');
      console.error(
        JSON.stringify(result.failures, null, 2),
      );
      process.exit(1);
    }

    if (result.invalidTokens.length > 0) {
      console.error(
        'The device token is invalid or unregistered.',
      );
      process.exit(1);
    }

    console.log(
      'Accepted by FCM — the device should show the notification now.',
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error('FCM error:', message);
    process.exit(1);
  }
}

void main();
