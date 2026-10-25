import 'dart:math';

const maxOnlineAttempts = 8;
const _base = Duration(seconds: 5);
const _cap = Duration(minutes: 15);

/// Delay after the Nth failed attempt (1-based): 5 s, 10 s, 20 s … capped at 15 min, ±20 % jitter
/// so a thousand phones coming back online together don't hit the server in lock-step.
Duration backoffDelay(int attempt, {double Function()? random}) {
  final n = attempt < 1 ? 1 : (attempt > 30 ? 30 : attempt);
  final raw = (_base.inMilliseconds * pow(2, n - 1)).toDouble();
  final capped = min(raw, _cap.inMilliseconds.toDouble());
  final r = (random ?? Random().nextDouble)(); // 0..1
  return Duration(milliseconds: (capped * (0.8 + 0.4 * r)).round());
}

enum FailureKind { permanent, transient }

/// Retrying a request the server has rejected as invalid can never succeed; retrying an outage or a rate limit can.
FailureKind classifyFailure({int? statusCode}) {
  if (statusCode == null) return FailureKind.transient; // no response at all: a network problem
  if (statusCode == 401 || statusCode == 408 || statusCode == 425 || statusCode == 429 || statusCode >= 500) {
    return FailureKind.transient; // 401: the session may be refreshed or the user may sign in again
  }
  return FailureKind.permanent; // other 4xx: validation, forbidden, not found, too large…
}