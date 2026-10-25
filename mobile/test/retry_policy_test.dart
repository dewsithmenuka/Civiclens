import 'package:civiclens/features/reporting/retry_policy.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('backoffDelay', () {
    test('doubles each attempt (no jitter) and caps at 15 minutes', () {
      Duration d(int n) => backoffDelay(n, random: () => 0.5); // 0.5 → jitter factor exactly 1.0
      expect(d(1), const Duration(seconds: 5));
      expect(d(2), const Duration(seconds: 10));
      expect(d(3), const Duration(seconds: 20));
      expect(d(6), const Duration(seconds: 160));
      expect(d(9), const Duration(minutes: 15));
      expect(d(40), const Duration(minutes: 15));
    });
    test('jitter stays within ±20 %', () {
      expect(backoffDelay(3, random: () => 0).inMilliseconds, 16000);
      expect(backoffDelay(3, random: () => 1).inMilliseconds, 24000);
    });
    test('treats nonsense attempt numbers as the first', () {
      expect(backoffDelay(0, random: () => 0.5), const Duration(seconds: 5));
      expect(backoffDelay(-3, random: () => 0.5), const Duration(seconds: 5));
    });
  });

  group('classifyFailure', () {
    test('no response is transient', () => expect(classifyFailure(), FailureKind.transient));
    test('outages and rate limits are transient', () {
      for (final c in [401, 408, 425, 429, 500, 502, 503, 504]) {
        expect(classifyFailure(statusCode: c), FailureKind.transient, reason: '$c');
      }
    });
    test('rejections are permanent', () {
      for (final c in [400, 403, 404, 409, 413, 422]) {
        expect(classifyFailure(statusCode: c), FailureKind.permanent, reason: '$c');
      }
    });
  });
}