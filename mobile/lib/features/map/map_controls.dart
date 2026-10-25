import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import '../../app/theme.dart';

/// Zoom in / zoom out (and optionally "my location") buttons for a flutter_map.
class MapControls extends StatelessWidget {
  final MapController controller;
  final VoidCallback? onLocate;
  const MapControls({super.key, required this.controller, this.onLocate});

  void _zoom(double delta) {
    final cam = controller.camera;
    controller.move(cam.center, (cam.zoom + delta).clamp(3.0, 19.0).toDouble());
  }

  Widget _button(IconData icon, String tooltip, VoidCallback onTap) => FloatingActionButton.small(
        heroTag: null, // several FABs on one screen — disable Hero to avoid tag clashes
        tooltip: tooltip,
        onPressed: onTap,
        backgroundColor: Tokens.surface,
        foregroundColor: Tokens.text,
        elevation: 2,
        child: Icon(icon),
      );

  @override
  Widget build(BuildContext context) {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      _button(Icons.add, 'Zoom in', () => _zoom(1)),
      const SizedBox(height: 8),
      _button(Icons.remove, 'Zoom out', () => _zoom(-1)),
      if (onLocate != null) ...[
        const SizedBox(height: 8),
        _button(Icons.my_location, 'My location', onLocate!),
      ],
    ]);
  }
}