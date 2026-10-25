import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import 'auth_controller.dart';

class Profile {
  final String id, email, displayName, role;
  final bool emailVerified;
  const Profile({
    required this.id, required this.email, required this.displayName,
    required this.role, required this.emailVerified,
  });

  factory Profile.fromJson(Map<String, dynamic> j) => Profile(
        id: j['id'] as String,
        email: j['email'] as String,
        displayName: j['displayName'] as String,
        role: j['role'] as String,
        emailVerified: j['emailVerified'] as bool,
      );
}

/// The signed-in user's profile (GET /auth/me). Re-fetched automatically if the account changes.
final profileProvider = FutureProvider.autoDispose<Profile>((ref) async {
  ref.watch(authProvider);
  final r = await ref.watch(dioProvider).get('/auth/me');
  return Profile.fromJson(Map<String, dynamic>.from(r.data as Map));
});