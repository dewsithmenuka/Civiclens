import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app/messenger.dart';
import 'app/router.dart';
import 'app/theme.dart';
import 'core/config.dart';
import 'features/auth/auth_controller.dart';
import 'features/notifications/push_service.dart';

void main() => runApp(const ProviderScope(child: CivicLensApp()));

class CivicLensApp extends ConsumerWidget {
  const CivicLensApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!apiIsProductionSafe) {
      return MaterialApp(
        title: 'CivicLens',
        theme: buildTheme(),
        home: const _ReleaseConfigurationScreen(),
      );
    }

    // Register for push as soon as someone is signed in (a no-op unless PUSH_ENABLED).
    ref.listen<AuthStatus>(authProvider, (_, next) {
      if (next == AuthStatus.signedIn) ref.read(pushProvider).start();
    });
    return MaterialApp.router(
      title: 'CivicLens',
      theme: buildTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: ThemeMode.system,
      routerConfig: ref.watch(routerProvider),
      scaffoldMessengerKey: messengerKey,
      debugShowCheckedModeBanner: false,
    );
  }
}

class _ReleaseConfigurationScreen extends StatelessWidget {
  const _ReleaseConfigurationScreen();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.lock_outline, size: 48),
                const SizedBox(height: 16),
                Text(
                  'CivicLens needs a secure API address before release.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Set HTTPS API_BASE and PRIVACY_POLICY_URL with --dart-define for release builds.',
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      );
}