import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';

enum AuthStatus { unknown, signedOut, signedIn }

final _googleSignIn = GoogleSignIn(
    scopes: const ['email'],
    serverClientId: googleEnabled ? googleServerClientId : null);

class AuthController extends Notifier<AuthStatus> {
  @override
  AuthStatus build() {
    ref.listen(sessionExpiredProvider, (_, __) => state = AuthStatus.signedOut);
    _bootstrap();
    return AuthStatus.unknown;
  }

  Future<void> _bootstrap() async {
    final t = await ref.read(tokenStoreProvider).refresh;
    state = t == null ? AuthStatus.signedOut : AuthStatus.signedIn;
  }

  Future<void> _store(Map data) async {
    await ref
        .read(tokenStoreProvider)
        .save(data['accessToken'], data['refreshToken']);
    state = AuthStatus.signedIn;
  }

  Future<void> login(String email, String password) async => _store((await ref
          .read(dioProvider)
          .post('/auth/login', data: {'email': email, 'password': password}))
      .data);

  Future<void> register(String email, String password, String name) async =>
      _store((await ref.read(dioProvider).post('/auth/register', data: {
        'email': email,
        'password': password,
        'displayName': name
      }))
          .data);

  /// Returns false if the user closed the Google sheet without choosing an account.
  /// Google proves who they are with an ID token; our server verifies it and issues its own tokens.
  Future<bool> loginWithGoogle() async {
    final account = await _googleSignIn.signIn();
    if (account == null) return false;
    final idToken = (await account.authentication).idToken;
    if (idToken == null) {
      throw StateError(
          'Google did not return an ID token (is GOOGLE_SERVER_CLIENT_ID set?)');
    }
    final res = await ref
        .read(dioProvider)
        .post('/auth/google', data: {'idToken': idToken});
    await _store(res.data as Map);
    return true;
  }

  Future<String?> googleIdTokenForReauthentication() async {
    final account = await _googleSignIn.signIn();
    if (account == null) return null;
    final idToken = (await account.authentication).idToken;
    if (idToken == null) {
      throw StateError(
          'Google did not return an ID token. Check the server client ID configuration.');
    }
    return idToken;
  }

  Future<void> deleteAccount({String? password, String? googleIdToken}) async {
    await ref.read(dioProvider).delete(
      '/auth/me',
      data: {
        if (password != null) 'password': password,
        if (googleIdToken != null) 'googleIdToken': googleIdToken,
      },
    );
    await ref.read(tokenStoreProvider).clear();
    if (googleEnabled) await _googleSignIn.signOut();
    state = AuthStatus.signedOut;
  }

  Future<void> logout() async {
    final store = ref.read(tokenStoreProvider);
    final rt = await store.refresh;
    if (rt != null) {
      try {
        await ref
            .read(dioProvider)
            .post('/auth/logout', data: {'refreshToken': rt});
      } catch (_) {/* offline logout still clears local tokens */}
    }
    await store.clear();
    if (googleEnabled) {
      try {
        await _googleSignIn
            .signOut(); // so the account chooser appears next time
      } catch (_) {}
    }
    state = AuthStatus.signedOut;
  }
}

final authProvider =
    NotifierProvider<AuthController, AuthStatus>(AuthController.new);
