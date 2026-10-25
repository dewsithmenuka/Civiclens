# CivicLens mobile app

## Development

Run the app from this directory. Use `API_BASE` to point at the local backend.

```sh
flutter pub get
flutter run --dart-define=API_BASE=http://10.0.2.2:3000 # Android emulator
flutter run --dart-define=API_BASE=http://localhost:3000 # iOS simulator or web
```

Android debug builds allow cleartext HTTP for local development. Release
manifests explicitly disable cleartext traffic.

## Release builds

Release builds require HTTPS values for both `API_BASE` and
`PRIVACY_POLICY_URL`; the app shows a configuration screen instead of
starting if either is missing or not HTTPS.

```sh
flutter build appbundle \
  --dart-define=API_BASE=https://api.example.com \
  --dart-define=PRIVACY_POLICY_URL=https://example.com/privacy

flutter build web \
  --dart-define=API_BASE=https://api.example.com \
  --dart-define=PRIVACY_POLICY_URL=https://example.com/privacy
```

For a signed Android release, provide all four values through the environment:
`CIVICLENS_KEYSTORE_PATH`, `CIVICLENS_KEYSTORE_PASSWORD`,
`CIVICLENS_KEY_ALIAS`, and `CIVICLENS_KEY_PASSWORD`. If none are supplied, the
Android release artifact is unsigned. Do not commit keystores or passwords.
iOS distribution signing and provisioning profiles must be configured in
Xcode. The app version and build number are maintained in `pubspec.yaml`.

Google sign-in and push notifications remain build-time configurable using
`GOOGLE_SERVER_CLIENT_ID` and `PUSH_ENABLED` after their production provider
configuration is installed.

## App icons

The source icon and transparent Android adaptive foreground are generated with
the checked-in Swift drawing script. Regenerate every platform's launcher and
web icons after changing the source:

```sh
swift tool/generate_icon.swift assets/branding
dart run flutter_launcher_icons
```

The generated web icon is also used by the Next.js admin dashboard at
`../admin/src/app/icon.png`.
