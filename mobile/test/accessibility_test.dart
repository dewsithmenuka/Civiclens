import 'package:civiclens/app/theme.dart';
import 'package:civiclens/core/config.dart';
import 'package:civiclens/features/auth/login_screen.dart';
import 'package:civiclens/features/reporting/report_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

Widget app({double textScale = 1}) => ProviderScope(
      child: MaterialApp(
        theme: buildTheme(),
        builder: (c, child) => MediaQuery(
            data: MediaQuery.of(c)
                .copyWith(textScaler: TextScaler.linear(textScale)),
            child: child!),
        home: const LoginScreen(),
      ),
    );

void main() {
  test('light and dark design themes expose the expected brightness', () {
    expect(buildTheme().brightness, Brightness.light);
    expect(buildDarkTheme().brightness, Brightness.dark);
  });

  test('release config requires HTTPS API and policy origins', () {
    expect(
      isSafeReleaseConfig(
        apiBase: 'https://api.example.com',
        privacyPolicyUrl: 'https://example.com/privacy',
      ),
      isTrue,
    );
    expect(
      isSafeReleaseConfig(
        apiBase: 'http://api.example.com',
        privacyPolicyUrl: 'https://example.com/privacy',
      ),
      isFalse,
    );
    expect(
      isSafeReleaseConfig(
        apiBase: 'https://api.example.com',
        privacyPolicyUrl: '',
      ),
      isFalse,
    );
  });

  testWidgets('login screen meets Flutter accessibility guidelines',
      (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(app());
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    handle.dispose();
  });

  testWidgets('login screen does not overflow at 200% text size',
      (tester) async {
    await tester.pumpWidget(app(textScale: 2));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('report form does not overflow at 200% text size',
      (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: buildTheme(),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
            ),
            child: child!,
          ),
          home: const ReportScreen(
            initial: LatLng(40.7128, -74.0060),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Report an issue'), findsOneWidget);
  });
}
