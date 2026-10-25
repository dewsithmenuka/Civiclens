import 'dart:async';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/models.dart';

class IssueMapState {
  final Map<String, Issue> issues;
  final String? hint;
  const IssueMapState({this.issues = const {}, this.hint});
  IssueMapState copy({Map<String, Issue>? issues, String? hint, bool clearHint = false}) =>
      IssueMapState(issues: issues ?? this.issues, hint: clearHint ? null : (hint ?? this.hint));
}

const _events = ['issue.created', 'issue.updated', 'issue.status_changed', 'issue.confirmed', 'issue.resolved'];
const _hiddenStatuses = {'DUPLICATE', 'REJECTED'};
const minZoomForQuery = 11.0; // the API refuses viewports wider than 2° — don't even ask when zoomed out

/// Viewport-driven data: REST for the initial snapshot, Socket.IO for live deltas.
/// The server only pushes events for the tiles covered by the viewport we last subscribed with.
class IssueMapNotifier extends Notifier<IssueMapState> {
  late final io.Socket _socket;
  LatLngBounds? _bounds;
  int _requestId = 0;

  @override
  IssueMapState build() {
    _socket = io.io('$apiBase/live', io.OptionBuilder().setTransports(['websocket']).disableAutoConnect().build());
    _socket.onConnect((_) => _subscribe()); // re-subscribe after every reconnect
    for (final e in _events) {
      _socket.on(e, (d) => _upsert(Issue.fromJson(Map<String, dynamic>.from(d as Map))));
    }
    _socket.connect();
    ref.onDispose(_socket.dispose);
    return const IssueMapState();
  }

  void _upsert(Issue i) {
    final bounds = _bounds;
    if (bounds == null || !bounds.contains(LatLng(i.lat, i.lng))) return;
    final next = Map<String, Issue>.of(state.issues);
    _hiddenStatuses.contains(i.status) ? next.remove(i.id) : next[i.id] = i;
    state = state.copy(issues: next);
  }

  void _subscribe() {
    final b = _bounds;
    if (b == null || !_socket.connected) return;
    _socket.emit('viewport.subscribe',
        {'bbox': {'minLng': b.west, 'minLat': b.south, 'maxLng': b.east, 'maxLat': b.north}});
  }

  Future<void> onViewportChanged(LatLngBounds bounds, double zoom) async {
    final requestId = ++_requestId;
    if (zoom < minZoomForQuery) {
      _bounds = null;
      state = const IssueMapState(hint: 'Zoom in to see reports');
      return;
    }
    _bounds = bounds;
    try {
      final r = await ref.read(dioProvider).get('/issues/map', queryParameters: {
        'minLng': bounds.west, 'minLat': bounds.south, 'maxLng': bounds.east, 'maxLat': bounds.north,
      });
      final list = (r.data as List).map((j) => Issue.fromJson(Map<String, dynamic>.from(j))).toList();
      if (requestId != _requestId) return;
      // Keep only what the viewport returned: never hold the whole dataset in memory.
      state = IssueMapState(issues: {for (final i in list) i.id: i});
      _subscribe();
    } catch (e) {
      if (requestId != _requestId) return;
      state = state.copy(hint: errorMessage(e));
    }
  }
}

final issueMapProvider = NotifierProvider<IssueMapNotifier, IssueMapState>(IssueMapNotifier.new);