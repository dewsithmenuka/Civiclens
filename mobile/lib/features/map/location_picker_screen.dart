import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import '../../app/theme.dart';
import '../search/place_search.dart';
import 'map_controls.dart';

/// Full-screen picker: drag the map under a fixed pin (or search a place), then confirm.
/// Returns the chosen LatLng via context.pop(LatLng).
class LocationPickerScreen extends StatefulWidget {
  final LatLng initial;
  const LocationPickerScreen({super.key, required this.initial});
  @override
  State<LocationPickerScreen> createState() => _LocationPickerScreenState();
}

class _LocationPickerScreenState extends State<LocationPickerScreen> {
  final _map = MapController();
  late LatLng _center = widget.initial;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: widget.initial,
            initialZoom: 17,
            onPositionChanged: (camera, _) => _center = camera.center,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'dev.civiclens.civiclens',
            ),
            const RichAttributionWidget(attributions: [TextSourceAttribution('© OpenStreetMap contributors')]),
          ],
        ),
        // Fixed pin: its tip sits exactly at the map centre.
        const IgnorePointer(
          child: Center(
            child: Padding(
              padding: EdgeInsets.only(bottom: 48),
              child: Icon(Icons.location_on, size: 48, color: Tokens.danger),
            ),
          ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              IconButton.filled(
                tooltip: 'Back',
                style: IconButton.styleFrom(backgroundColor: Tokens.surface, foregroundColor: Tokens.text),
                onPressed: () => context.pop(),
                icon: const Icon(Icons.arrow_back),
              ),
              const SizedBox(width: 8),
              Expanded(child: PlaceSearchBar(onSelected: (p) => flyToPlace(_map, p))),
            ]),
          ),
        ),
        Positioned(right: 16, bottom: 110, child: MapControls(controller: _map)),
        Positioned(
          left: 20,
          right: 20,
          bottom: 28,
          child: SafeArea(
            child: FilledButton.icon(
              icon: const Icon(Icons.check),
              label: const Text('Use this location'),
              onPressed: () => context.pop(_center),
            ),
          ),
        ),
      ]),
    );
  }
}