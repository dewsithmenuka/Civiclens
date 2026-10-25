import 'package:flutter/foundation.dart';
import 'release_config.dart';

export 'release_config.dart' show isSafeReleaseConfig;

/// Override per build:  flutter run --dart-define=API_BASE=http://localhost:3000
/// Android emulator: http://10.0.2.2:3000 · iOS simulator: http://localhost:3000 ·
/// real phone on the same Wi-Fi: http://<your-Mac's-LAN-IP>:3000
const _configuredApiBase = String.fromEnvironment('API_BASE');
final apiBase = _configuredApiBase.isNotEmpty
    ? _configuredApiBase
    : 'http://localhost:3000';
final apiV1 = '$apiBase/api/v1';

/// Set for release builds so the Account screen can link to the published policy.
const privacyPolicyUrl = String.fromEnvironment('PRIVACY_POLICY_URL');
final apiIsProductionSafe = kDebugMode ||
    isSafeReleaseConfig(
      apiBase: _configuredApiBase,
      privacyPolicyUrl: privacyPolicyUrl,
    );

/// The WEB client ID from Google Cloud. Passing it makes Google issue ID tokens addressed to our server.
/// Leave unset and the "Continue with Google" button simply doesn't appear.
///   flutter run --dart-define=GOOGLE_SERVER_CLIENT_ID=xxxx.apps.googleusercontent.com
const googleServerClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');
const googleEnabled = googleServerClientId != '';

/// Master switch for push notifications. Leave it OFF until Firebase is configured (see Part 3):
///   flutter run --dart-define=PUSH_ENABLED=true
const pushEnabled = bool.fromEnvironment('PUSH_ENABLED');

/// Public geocoders require an identifiable contact. Pass your real email:
///   flutter run --dart-define=GEOCODER_CONTACT=you@gmail.com
const geocoderContact = String.fromEnvironment('GEOCODER_CONTACT',
    defaultValue: 'set-GEOCODER_CONTACT@example.com');
