import 'package:flutter/material.dart';
import '../../app/theme.dart';

String statusLabel(String s) => s.toLowerCase().replaceAll('_', ' ');

IconData? statusGlyph(String s) => switch (s) {
      'RESOLVED' => Icons.check,
      'IN_PROGRESS' || 'ACKNOWLEDGED' => Icons.construction,
      'UNDER_REVIEW' => Icons.visibility_outlined,
      _ => null,
    };

/// Category icon on a status-coloured disc, with a status glyph so colour is never the only signal.
class StatusPin extends StatelessWidget {
  const StatusPin({super.key, required this.category, required this.status});
  final String category, status;

  @override
  Widget build(BuildContext context) {
    final glyph = statusGlyph(status);
    return Stack(clipBehavior: Clip.none, children: [
      Container(
        width: 40, height: 40,
        decoration: BoxDecoration(
          color: statusColor(status), shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(blurRadius: 6, color: Colors.black26)],
        ),
        child: Icon(categoryIcon(category), color: Colors.white, size: 20),
      ),
      if (glyph != null)
        Positioned(
          right: -3, bottom: -3,
          child: Container(
            width: 18, height: 18,
            decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle, border: Border.all(color: statusColor(status), width: 1.5)),
            child: Icon(glyph, size: 12, color: statusColor(status)),
          ),
        ),
    ]);
  }
}