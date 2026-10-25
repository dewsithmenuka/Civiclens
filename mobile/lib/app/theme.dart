import 'package:flutter/material.dart';

/// CivicLens design tokens.
class Tokens {
  static const bg = Color(0xFFF7F7F4);
  static const surface = Color(0xFFFFFFFF);
  static const text = Color(0xFF20211F);

  // Improved contrast for readable secondary text.
  static const muted = Color(0xFF5C5F59);

  static const accent = Color(0xFF2F7D67);
  static const accentDark = Color(0xFF276B58);

  // Use warning for decorative fills only.
  static const warning = Color(0xFFD99A2B);

  // Use warningText wherever amber is used as text.
  static const warningText = Color(0xFF8A5D0A);

  static const danger = Color(0xFFA63C32);
  static const border = Color(0xFFE6E6E0);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Tokens.accent,
    surface: Tokens.surface,
  ).copyWith(
    primary: Tokens.accent,
    error: Tokens.danger,
  );

  OutlineInputBorder inputBorder() {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: const BorderSide(color: Tokens.border),
    );
  }

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Tokens.bg,
    fontFamily: 'Inter',
    appBarTheme: const AppBarTheme(
      backgroundColor: Tokens.bg,
      foregroundColor: Tokens.text,
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Tokens.surface,
      border: inputBorder(),
      enabledBorder: inputBorder(),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
    ),
  );
}

ThemeData buildDarkTheme() {
  const background = Color(0xFF111613);
  const surface = Color(0xFF1B231F);
  const elevatedSurface = Color(0xFF252E29);
  const foreground = Color(0xFFF0F4F1);
  const muted = Color(0xFFB7C2BB);
  const border = Color(0xFF46534B);
  const accent = Color(0xFF83D1B4);
  const danger = Color(0xFFFFB4A9);
  final scheme = ColorScheme.fromSeed(
    brightness: Brightness.dark,
    seedColor: Tokens.accent,
    surface: surface,
  ).copyWith(
    primary: accent,
    onPrimary: const Color(0xFF00382A),
    error: danger,
    onSurface: foreground,
    onSurfaceVariant: muted,
    outlineVariant: border,
  );

  OutlineInputBorder inputBorder() => OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: border),
      );

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    scaffoldBackgroundColor: background,
    fontFamily: 'Inter',
    appBarTheme: const AppBarTheme(
      backgroundColor: background,
      foregroundColor: foreground,
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: elevatedSurface,
      border: inputBorder(),
      enabledBorder: inputBorder(),
      hintStyle: const TextStyle(color: muted),
    ),
    dividerColor: border,
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
    ),
  );
}

/// Marker fill per lifecycle status.
///
/// These colours are chosen to provide sufficient contrast for white
/// marker icons and borders against the marker fill.
Color statusColor(String status) => switch (status) {
      'RESOLVED' => Tokens.accent,
      'IN_PROGRESS' || 'ACKNOWLEDGED' => const Color(0xFF9A6A0F),
      'UNDER_REVIEW' => const Color(0xFF4A6A8A),
      _ => Tokens.danger,
    };

/// Icon associated with each report category.
IconData categoryIcon(String category) => switch (category) {
      'ROADS' => Icons.add_road,
      'LIGHTING' => Icons.lightbulb_outline,
      'WATER' => Icons.water_drop_outlined,
      'WASTE' => Icons.delete_outline,
      'TRAFFIC' => Icons.traffic_outlined,
      'ACCESSIBILITY' => Icons.accessible_forward,
      _ => Icons.report_gmailerrorred,
    };
