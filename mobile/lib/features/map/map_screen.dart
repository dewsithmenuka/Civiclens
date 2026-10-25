
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/theme.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../auth/verify_banner.dart';
import '../notifications/notifications_provider.dart';
import '../notifications/push_service.dart';
import '../reporting/offline_banner.dart';
import '../reporting/pending_reports_sheet.dart';
import '../reporting/report_queue.dart';
import '../search/place_search.dart';
import 'map_controller.dart';
import 'map_controls.dart';
import 'status_pin.dart';

class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key, this.initialFocus});
  final LatLng? initialFocus;

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen>
    with WidgetsBindingObserver {
  final _map = MapController();
  Timer? _debounce;
  late LatLng _center = widget.initialFocus ?? const LatLng(40.7128, -74.0060);
  LatLng? _pressed;
  bool _focused = false;
  int _zoomBucket = 14;

  @override
  void initState() {
    super.initState();

    WidgetsBinding.instance.addObserver(this);
    if (widget.initialFocus != null) {
      _focused = true;
    } else {
      _locate(initial: true);
    }

    // The app may have been opened by tapping a push before this screen existed.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final id = ref.read(pendingFocusProvider);
      if (id != null) _focusIssue(id);
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _debounce?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _locate(requestPermission: false);
      _scheduleFetch();
    }
  }

  Future<void> _locate({
    bool initial = false,
    bool requestPermission = true,
  }) async {
    try {
      var perm = await Geolocator.checkPermission();

      if (perm == LocationPermission.denied && requestPermission) {
        perm = await Geolocator.requestPermission();
      }

      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Location permission is off — you can still search for a place.',
              ),
            ),
          );
        }
        return;
      }

      final p = await Geolocator.getCurrentPosition(
        timeLimit: const Duration(seconds: 12),
      );
      _center = LatLng(p.latitude, p.longitude);

      // A notification already moved the camera; don't override it with GPS.
      if (initial && _focused) return;

      _map.move(_center, 16);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not get your location: $error')),
        );
      }
    }
  }

  /// Fly to a report from a tapped push notification or in-app banner.
  Future<void> _focusIssue(String id) async {
    ref.read(pendingFocusProvider.notifier).state = null;
    _focused = true;

    try {
      final r = await ref.read(dioProvider).get('/issues/$id');
      final loc = r.data['location'];

      if (mounted) {
        _map.move(
          LatLng(
            (loc['lat'] as num).toDouble(),
            (loc['lng'] as num).toDouble(),
          ),
          17,
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('This report is no longer available.'),
          ),
        );
      }
    }
  }

  void _scheduleFetch() {
    // Fetch when the camera settles, not on every frame.
    _debounce?.cancel();

    _debounce = Timer(const Duration(milliseconds: 400), () {
      final cam = _map.camera;
      ref
          .read(issueMapProvider.notifier)
          .onViewportChanged(cam.visibleBounds, cam.zoom);
    });
  }

  List<Marker> _issueMarkers(Iterable<Issue> issues) {
    final worldSize = 256 * math.pow(2, _zoomBucket);
    final buckets = <String, List<Issue>>{};

    for (final issue in issues) {
      final latitude = issue.lat * math.pi / 180;
      final sinLatitude = math.sin(latitude).clamp(-0.9999, 0.9999);
      final x = (issue.lng + 180) / 360 * worldSize;
      final y = (0.5 -
              math.log((1 + sinLatitude) / (1 - sinLatitude)) /
                  (4 * math.pi)) *
          worldSize;
      final key = '${(x / 56).floor()}:${(y / 56).floor()}';
      buckets.putIfAbsent(key, () => []).add(issue);
    }

    return [
      for (final bucket in buckets.values)
        if (bucket.length == 1)
          _singleIssueMarker(bucket.single)
        else
          _clusterMarker(bucket),
    ];
  }

  Marker _singleIssueMarker(Issue issue) => Marker(
        point: LatLng(issue.lat, issue.lng),
        width: 48,
        height: 48,
        child: Semantics(
          button: true,
          label:
              '${categories[issue.category]} issue: ${issue.title}. '
              'Status: ${statusLabel(issue.status)}. Double tap for details.',
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => _showIssue(context, issue),
            child: ExcludeSemantics(
              child: Center(
                child: StatusPin(
                  category: issue.category,
                  status: issue.status,
                ),
              ),
            ),
          ),
        ),
      );

  Marker _clusterMarker(List<Issue> issues) {
    final center = LatLng(
      issues.map((issue) => issue.lat).reduce((a, b) => a + b) / issues.length,
      issues.map((issue) => issue.lng).reduce((a, b) => a + b) / issues.length,
    );
    final scheme = Theme.of(context).colorScheme;

    return Marker(
      point: center,
      width: 56,
      height: 56,
      child: Semantics(
        button: true,
        label: '${issues.length} reports. Tap to zoom in.',
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => _map.move(
            center,
            (_zoomBucket + 2).clamp(11, 19).toDouble(),
          ),
          child: ExcludeSemantics(
            child: Center(
              child: CircleAvatar(
                radius: 25,
                backgroundColor: scheme.primary,
                foregroundColor: scheme.onPrimary,
                child: Text(
                  issues.length > 99 ? '99+' : '${issues.length}',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Open the inbox and fly to the selected notification's location.
  Future<void> _openInbox() async {
    final target = await context.push<LatLng>('/notifications');

    if (target != null && mounted) {
      _map.move(target, 17);
    }
  }

  void _offerReportAt(LatLng point) {
    setState(() => _pressed = point);

    showModalBottomSheet(
      context: context,
      backgroundColor: Tokens.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (sheetContext) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Report an issue here?',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              '${point.latitude.toStringAsFixed(5)}, '
              '${point.longitude.toStringAsFixed(5)}',
              style: const TextStyle(color: Tokens.muted),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              icon: const Icon(Icons.add_a_photo_outlined),
              label: const Text('Report at this spot'),
              onPressed: () {
                Navigator.of(sheetContext).pop();
                context.push('/report', extra: point);
              },
            ),
          ],
        ),
      ),
    ).whenComplete(() {
      if (mounted) setState(() => _pressed = null);
    });
  }

  @override
  Widget build(BuildContext context) {
    // A push was tapped while the app was running.
    ref.listen<String?>(pendingFocusProvider, (_, id) {
      if (id != null) _focusIssue(id);
    });

    // Notify the user when a queued report has been sent.
    ref.listen<String?>(lastSentProvider, (_, title) {
      if (title == null) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Sent: $title')),
      );

      ref.read(lastSentProvider.notifier).state = null;
    });

    final data = ref.watch(issueMapProvider);
    final pending = ref.watch(reportQueueProvider);
    final unread = ref.watch(unreadCountProvider);
    final hasFailed = pending.any((r) => r.state == 'failed');

    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: _center,
              initialZoom: 14,
              onMapReady: _scheduleFetch,
              onPositionChanged: (camera, _) {
                final zoomBucket = camera.zoom.floor();
                if (zoomBucket != _zoomBucket && mounted) {
                  setState(() => _zoomBucket = zoomBucket);
                }
                _scheduleFetch();
              },
              onLongPress: (_, point) => _offerReportAt(point),
            ),
            children: [
              TileLayer(
                urlTemplate:
                    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'dev.civiclens.civiclens',
              ),
              MarkerLayer(
                markers: [
                  ..._issueMarkers(data.issues.values),
                  if (_pressed != null)
                    Marker(
                      point: _pressed!,
                      width: 48,
                      height: 48,
                      alignment: Alignment.topCenter,
                      child: const Icon(
                        Icons.location_on,
                        size: 48,
                        color: Tokens.danger,
                      ),
                    ),
                ],
              ),
              const RichAttributionWidget(
                attributions: [
                  TextSourceAttribution('© OpenStreetMap contributors'),
                ],
              ),
            ],
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: PlaceSearchBar(
                          onSelected: (p) => flyToPlace(_map, p),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton.filled(
                        tooltip: 'Discover reports',
                        style: IconButton.styleFrom(
                          backgroundColor: Tokens.surface,
                          foregroundColor: Tokens.text,
                        ),
                        onPressed: () => context.push('/discover'),
                        icon: const Icon(Icons.list_alt_outlined),
                      ),
                      const SizedBox(width: 4),
                      IconButton.filled(
                        tooltip: unread > 0
                            ? 'Notifications ($unread unread)'
                            : 'Notifications',
                        style: IconButton.styleFrom(
                          backgroundColor: Tokens.surface,
                          foregroundColor: Tokens.text,
                        ),
                        onPressed: _openInbox,
                        icon: Badge(
                          label: Text(unread > 99 ? '99+' : '$unread'),
                          isLabelVisible: unread > 0,
                          child: const Icon(Icons.notifications_outlined),
                        ),
                      ),
                      const SizedBox(width: 4),
                      IconButton.filled(
                        tooltip: 'Account and privacy',
                        style: IconButton.styleFrom(
                          backgroundColor: Tokens.surface,
                          foregroundColor: Tokens.text,
                        ),
                        onPressed: () => context.push('/account'),
                        icon: const Icon(Icons.person_outline),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Material(
                    elevation: 2,
                    borderRadius: BorderRadius.circular(20),
                    color: Tokens.surface,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.circle,
                            size: 9,
                            color: Tokens.accent,
                          ),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              data.hint ??
                                  '${data.issues.length} reports in view · live',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 13),
                            ),
                          ),
                          if (pending.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            InkWell(
                              onTap: () => showPendingReportsSheet(context),
                              borderRadius: BorderRadius.circular(8),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 4,
                                  vertical: 2,
                                ),
                                child: Text(
                                  hasFailed
                                      ? '${pending.length} need attention'
                                      : '${pending.length} pending',
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: hasFailed
                                        ? Tokens.danger
                                        : Tokens.warningText,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const VerifyEmailBanner(),
                  const SizedBox(height: 8),
                  const OfflineBanner(),
                ],
              ),
            ),
          ),
          Positioned(
            right: 16,
            bottom: 96,
            child: MapControls(
              controller: _map,
              onLocate: _locate,
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/report'),
        backgroundColor: Tokens.accent,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_a_photo_outlined),
        label: const Text('Report'),
      ),
    );
  }

  void _showIssue(BuildContext context, Issue i) {
    context.push('/issues/${i.id}');
  }
}
