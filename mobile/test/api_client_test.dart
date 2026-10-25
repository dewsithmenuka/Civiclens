import 'package:civiclens/core/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('errorMessage', () {
    test('explains connection loss without claiming unsent reports are queued',
        () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/issues'),
        type: DioExceptionType.connectionError,
      );
      expect(
        errorMessage(error),
        'No connection. Check your internet connection and try again.',
      );
    });

    test('explains request timeouts', () {
      for (final type in [
        DioExceptionType.connectionTimeout,
        DioExceptionType.sendTimeout,
        DioExceptionType.receiveTimeout,
      ]) {
        final error = DioException(
          requestOptions: RequestOptions(path: '/auth/login'),
          type: type,
        );
        expect(
          errorMessage(error),
          'The request timed out. Check your connection and try again.',
        );
      }
    });

    test('uses API validation messages when available', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/auth/register'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/register'),
          statusCode: 400,
          data: {
            'message': ['Email is invalid', 'Password is too short']
          },
        ),
      );
      expect(errorMessage(error), 'Email is invalid\nPassword is too short');
    });
  });
}
