import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/messenger.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import 'notifications_provider.dart';

/// Set when the user taps a push (or its in-app banner).
/// The map screen flies to that report.
final pendingFocusProvider = StateProvider<String?>((_) => null);

/// Runs in a background isolate.
///
/// The OS draws notification-type messages by itself,
/// so this only has to keep Firebase alive.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(
  RemoteMessage message,
) async {
  await Firebase.initializeApp();
}

/// Push registration and handling.
///
/// Everything here is a no-op unless built with:
/// --dart-define=PUSH_ENABLED=true
///
/// Push is a convenience and must never break the app.
class PushService {
  PushService(this._ref);

  final Ref _ref;

  final List<StreamSubscription<dynamic>> _subs =
      <StreamSubscription<dynamic>>[];

  bool _started = false;

  String? _token;

  /// Call after sign-in.
  /// Safe to call repeatedly.
  Future<void> start() async {
    if (!pushEnabled || _started) {
      return;
    }

    _started = true;

    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }

      final fm = FirebaseMessaging.instance;

      FirebaseMessaging.onBackgroundMessage(
        firebaseBackgroundHandler,
      );

      final settings = await fm.requestPermission();

      if (settings.authorizationStatus ==
          AuthorizationStatus.denied) {
        debugPrint(
          'CivicLens push: notification permission denied — '
          'the in-app inbox still works.',
        );
        return;
      }

      // While the app is open we show our own banner,
      // so don't let iOS draw a second one.
      await fm.setForegroundNotificationPresentationOptions(
        alert: false,
        badge: true,
        sound: false,
      );

      _subs.add(
        fm.onTokenRefresh.listen(_register),
      );

      _subs.add(
        FirebaseMessaging.onMessage.listen(_onForeground),
      );

      _subs.add(
        FirebaseMessaging.onMessageOpenedApp.listen(_onOpened),
      );

      await _fetchAndRegisterToken(fm);

      // App was launched by tapping a notification
      // while it was fully closed.
      final initial = await fm.getInitialMessage();

      if (initial != null) {
        _onOpened(initial);
      }
    } catch (e) {
      debugPrint(
        'CivicLens push: setup failed ($e) — '
        'continuing without push.',
      );

      _started = false;
    }
  }

  Future<void> _fetchAndRegisterToken(
    FirebaseMessaging fm,
  ) async {
    try {
      if (Platform.isIOS) {
        // iOS hands out an APNs token first.
        // It can take a moment, and it never arrives
        // on the simulator.
        for (
          var i = 0;
          i < 5 && await fm.getAPNSToken() == null;
          i++
        ) {
          await Future<void>.delayed(
            const Duration(seconds: 1),
          );
        }

        if (await fm.getAPNSToken() == null) {
          debugPrint(
            'CivicLens push: no APNs token '
            '(iOS simulator, or Push capability not enabled) '
            '— push unavailable on this device.',
          );
          return;
        }
      }

      final token = await fm.getToken();

      if (token != null) {
        await _register(token);
      }
    } catch (e) {
      debugPrint(
        'CivicLens push: could not get a push token ($e)',
      );
    }
  }

  Future<void> _register(String token) async {
    _token = token;

    if (kDebugMode) {
      debugPrint(
        'CivicLens push token: $token',
      );
    }

    try {
      await _ref.read(dioProvider).post(
        '/devices',
        data: {
          'token': token,
          'platform': Platform.isIOS ? 'ios' : 'android',
        },
      );
    } catch (e) {
      debugPrint(
        'CivicLens push: registering this device failed ($e)',
      );
    }
  }

  void _onForeground(RemoteMessage message) {
    _ref
        .read(notificationsProvider.notifier)
        .refresh();

    final notification = message.notification;

    final messenger = messengerKey.currentState;

    if (notification == null || messenger == null) {
      return;
    }

    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                notification.title ?? 'CivicLens',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (notification.body != null)
                Text(notification.body!),
            ],
          ),
          action: SnackBarAction(
            label: 'View',
            onPressed: () => _focus(message),
          ),
        ),
      );
  }

  void _onOpened(RemoteMessage message) {
    _ref
        .read(notificationsProvider.notifier)
        .refresh();

    _focus(message);
  }

  void _focus(RemoteMessage message) {
    final id = message.data['issueId'];

    if (id is String && id.isNotEmpty) {
      _ref
          .read(pendingFocusProvider.notifier)
          .state = id;
    }
  }

  /// Call BEFORE clearing the session.
  ///
  /// It needs the access token to stop this phone
  /// receiving the old user's pushes.
  Future<void> unregister() async {
    for (final subscription in List.of(_subs)) {
      await subscription.cancel();
    }

    _subs.clear();
    _started = false;

    if (!pushEnabled) {
      return;
    }

    final token = _token;
    _token = null;

    try {
      if (token != null) {
        await _ref.read(dioProvider).post(
          '/devices/unregister',
          data: {
            'token': token,
          },
        );
      }

      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // Best effort.
      // The server also deletes tokens Firebase reports as dead.
    }
  }
}

final pushProvider = Provider<PushService>(
  (ref) => PushService(ref),
);