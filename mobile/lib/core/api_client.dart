import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'config.dart';

/// Tokens live only in the platform keystore/keychain — never in SharedPreferences.
class TokenStore {
  static const _s = FlutterSecureStorage();
  Future<String?> get access => _s.read(key: 'access');
  Future<String?> get refresh => _s.read(key: 'refresh');
  Future<void> save(String access, String refresh) async {
    await _s.write(key: 'access', value: access);
    await _s.write(key: 'refresh', value: refresh);
  }

  Future<void> clear() async {
    await _s.delete(key: 'access');
    await _s.delete(key: 'refresh');
  }
}

final tokenStoreProvider = Provider((_) => TokenStore());

/// Bumped when refresh fails (session revoked/expired) so the UI can send the user to login.
final sessionExpiredProvider = StateProvider<int>((_) => 0);

final dioProvider = Provider<Dio>((ref) {
  final tokens = ref.watch(tokenStoreProvider);
  final dio = Dio(BaseOptions(
      baseUrl: apiV1, connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 20)));
  Future<bool?>? inFlight; // single-flight: concurrent 401s share ONE refresh (rotation would break otherwise)

  Future<bool?> doRefresh() async {
    final rt = await tokens.refresh;
    if (rt == null) return false;
    try {
      final r = await Dio(BaseOptions(
        baseUrl: apiV1,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 15),
      )).post('/auth/refresh', data: {'refreshToken': rt});
      await tokens.save(r.data['accessToken'], r.data['refreshToken']);
      return true;
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      if (status == 400 || status == 401 || status == 403) {
        await tokens.clear();
        return false;
      }
      return null;
    }
  }

  dio.interceptors.add(InterceptorsWrapper(
    onRequest: (o, h) async {
      final t = await tokens.access;
      if (t != null) o.headers['Authorization'] = 'Bearer $t';
      h.next(o);
    },
    onError: (e, h) async {
      final isAuthCall = e.requestOptions.path.startsWith('/auth/');
      if (e.response?.statusCode == 401 && !isAuthCall && e.requestOptions.extra['retried'] != true) {
        final refreshed = await (inFlight ??= doRefresh().whenComplete(() => inFlight = null));
        if (refreshed == true) {
          final o = e.requestOptions..extra['retried'] = true;
          o.headers['Authorization'] = 'Bearer ${await tokens.access}';
          try {
            return h.resolve(await dio.fetch(o));
          } on DioException catch (e2) {
            return h.next(e2);
          }
        }
        if (refreshed == false) {
          ref.read(sessionExpiredProvider.notifier).state++;
        }
      }
      h.next(e);
    },
  ));
  return dio;
});

/// Human-readable message from the API's error shape.
String errorMessage(Object e) {
  if (e is DioException) {
    final d = e.response?.data;
    if (d is Map && d['message'] != null) {
      final m = d['message'];
      return m is List ? m.join('\n') : m.toString();
    }
    if (e.type == DioExceptionType.connectionError) {
      return 'No connection. Check your internet connection and try again.';
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return 'The request timed out. Check your connection and try again.';
    }
  }
  return 'Something went wrong.';
}