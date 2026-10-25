import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import '../features/auth/auth_controller.dart';
import '../features/auth/account_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/issues/discover_screen.dart';
import '../features/issues/issue_details_screen.dart';
import '../features/map/location_picker_screen.dart';
import '../features/map/map_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/reporting/report_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0); // re-run redirects whenever auth state changes
  ref.listen(authProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      if (auth == AuthStatus.unknown) return null;
      final onLogin = state.matchedLocation == '/login';
      if (auth == AuthStatus.signedOut) return onLogin ? null : '/login';
      return onLogin ? '/' : null;
    },
    routes: [
      GoRoute(
        path: '/',
        builder: (_, state) => MapScreen(
          initialFocus: state.extra is LatLng ? state.extra as LatLng : null,
        ),
      ),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/account', builder: (_, __) => const AccountScreen()),
      GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
      GoRoute(path: '/discover', builder: (_, __) => const DiscoverScreen()),
      GoRoute(
        path: '/issues/:id',
        builder: (_, state) => IssueDetailsScreen(issueId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/report',
        builder: (_, state) => ReportScreen(initial: state.extra is LatLng ? state.extra as LatLng : null),
      ),
      GoRoute(
        path: '/pick-location',
        builder: (_, state) => LocationPickerScreen(
          initial: state.extra is LatLng ? state.extra as LatLng : const LatLng(40.7128, -74.0060),
        ),
      ),
    ],
  );
});