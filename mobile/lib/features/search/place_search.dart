import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import '../../app/theme.dart';
import '../../core/config.dart';

class Place {
  final String name;
  final LatLng point;
  final LatLngBounds? bounds;
  const Place(this.name, this.point, this.bounds);
}

class SearchException implements Exception {
  final String message;
  const SearchException(this.message);
  @override
  String toString() => message;
}

// ───────── pure parsing (unit-tested) ─────────

double? _num(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);

/// Nominatim: a JSON list; bounding box is [south, north, west, east] as strings.
List<Place> placesFromNominatim(Object? json) {
  if (json is! List) return const [];
  final out = <Place>[];
  for (final j in json) {
    if (j is! Map) continue;
    final lat = _num(j['lat']), lon = _num(j['lon']);
    final name = j['display_name'];
    if (lat == null || lon == null || name is! String) continue;
    LatLngBounds? bounds;
    final bb = j['boundingbox'];
    if (bb is List && bb.length == 4) {
      final v = bb.map(_num).toList();
      if (v.every((x) => x != null)) bounds = LatLngBounds(LatLng(v[0]!, v[2]!), LatLng(v[1]!, v[3]!));
    }
    out.add(Place(name, LatLng(lat, lon), bounds));
  }
  return out;
}

/// "Brandenburger Tor, Pariser Platz 1, Mitte, Berlin, Germany" — without repeating a part twice.
String photonLabel(Map props) {
  String? s(String k) {
    final v = props[k];
    return v is String && v.trim().isNotEmpty ? v.trim() : null;
  }

  final street = [s('street'), s('housenumber')].whereType<String>().join(' ');
  final parts = <String>[
    if (s('name') != null) s('name')!,
    if (street.isNotEmpty) street,
    if (s('district') != null) s('district')!,
    if (s('city') != null) s('city')!,
    if (s('state') != null) s('state')!,
    if (s('country') != null) s('country')!,
  ];
  final seen = <String>{};
  return parts.where((p) => seen.add(p.toLowerCase())).join(', ');
}

/// Photon: GeoJSON. Coordinates are [lon, lat]; `extent` is [minLon, maxLat, maxLon, minLat].
List<Place> placesFromPhoton(Object? json) {
  final features = json is Map ? json['features'] : null;
  if (features is! List) return const [];
  final out = <Place>[];
  for (final f in features) {
    if (f is! Map) continue;
    final g = f['geometry'], p = f['properties'];
    if (g is! Map || p is! Map) continue;
    final c = g['coordinates'];
    if (c is! List || c.length < 2) continue;
    final lon = _num(c[0]), lat = _num(c[1]);
    if (lon == null || lat == null) continue;
    final label = photonLabel(p);
    if (label.isEmpty) continue;
    LatLngBounds? bounds;
    final e = p['extent'];
    if (e is List && e.length == 4) {
      final v = e.map(_num).toList();
      if (v.every((x) => x != null)) bounds = LatLngBounds(LatLng(v[3]!, v[0]!), LatLng(v[1]!, v[2]!));
    }
    out.add(Place(label, LatLng(lat, lon), bounds));
  }
  return out;
}

String describeSearchError(DioException e, String service) {
  switch (e.type) {
    case DioExceptionType.connectionError:
      return 'No connection — check your internet.';
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.receiveTimeout:
    case DioExceptionType.sendTimeout:
      return '$service timed out. Try again.';
    default:
      break;
  }
  final code = e.response?.statusCode;
  if (code == 403) return '$service refused the request (403). Run the app with --dart-define=GEOCODER_CONTACT=your@email.';
  if (code == 429) return 'Too many searches — wait a few seconds.';
  if (code != null) return '$service answered $code.';
  return '$service failed.';
}

// ───────── geocoding ─────────

typedef _Backend = Future<List<Place>> Function(String q, LatLng? near, CancelToken? cancel);

class Geocoder {
  Geocoder()
      : _dio = Dio(BaseOptions(
          connectTimeout: const Duration(seconds: 8),
          receiveTimeout: const Duration(seconds: 8),
          headers: {'User-Agent': 'CivicLens/0.5 (+contact: $geocoderContact)', 'Accept-Language': 'en'},
        ));
  final Dio _dio;

  Future<List<Place>> _nominatim(String q, LatLng? near, CancelToken? cancel) async {
    final r = await _dio.get('https://nominatim.openstreetmap.org/search', cancelToken: cancel, queryParameters: {
      'q': q, 'format': 'jsonv2', 'limit': 5,
      if (near != null) ...{
        'viewbox': '${near.longitude - 0.5},${near.latitude + 0.5},${near.longitude + 0.5},${near.latitude - 0.5}',
        'bounded': 0,
      },
    });
    return placesFromNominatim(r.data);
  }

  Future<List<Place>> _photon(String q, LatLng? near, CancelToken? cancel) async {
    final r = await _dio.get('https://photon.komoot.io/api/', cancelToken: cancel, queryParameters: {
      'q': q, 'limit': 6, 'lang': 'en',
      if (near != null) ...{'lat': near.latitude, 'lon': near.longitude},
    });
    return placesFromPhoton(r.data);
  }

  /// `precise` (Enter pressed) asks Nominatim first; while typing, Photon goes first. Either falls back to the other.
  Future<List<Place>> search(String query, {LatLng? near, bool precise = false, CancelToken? cancel}) async {
    final steps = <(String, _Backend)>[
      if (precise) ('Nominatim', _nominatim) else ('Photon', _photon),
      if (precise) ('Photon', _photon) else ('Nominatim', _nominatim),
    ];
    SearchException? lastError;
    var anySucceeded = false;
    for (final (name, run) in steps) {
      try {
        final results = await run(query, near, cancel);
        anySucceeded = true;
        if (results.isNotEmpty) return results;
      } on DioException catch (e) {
        if (CancelToken.isCancel(e)) rethrow;
        lastError = SearchException(describeSearchError(e, name));
      }
    }
    if (!anySucceeded && lastError != null) throw lastError;
    return const []; // at least one service answered: there really is nothing for this query
  }
}

final geocoderProvider = Provider((_) => Geocoder());

/// Move the camera to a search result: fit the place's bounds (a city zooms out, a street zooms in).
void flyToPlace(MapController map, Place p) {
  if (p.bounds != null) {
    map.fitCamera(CameraFit.bounds(bounds: p.bounds!, padding: const EdgeInsets.all(48), maxZoom: 17));
  } else {
    map.move(p.point, 16);
  }
}

// ───────── UI ─────────

class PlaceSearchBar extends ConsumerStatefulWidget {
  final void Function(Place) onSelected;

  /// Where the user is looking right now; results near it rank higher.
  final LatLng Function()? near;
  final String hint;
  const PlaceSearchBar({super.key, required this.onSelected, this.near, this.hint = 'Search a place or address'});
  @override
  ConsumerState<PlaceSearchBar> createState() => _PlaceSearchBarState();
}

class _PlaceSearchBarState extends ConsumerState<PlaceSearchBar> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  Timer? _debounce;
  CancelToken? _cancel;
  int _seq = 0; // only the newest request may update the screen
  List<Place> _results = const [];
  bool _loading = false, _isError = false;
  String? _message;

  void _onChanged(String text) {
    _debounce?.cancel();
    setState(() {});
    if (text.trim().length < 3) {
      _cancel?.cancel();
      _seq++;
      setState(() { _results = const []; _message = null; _loading = false; });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 550), () => _search(text, precise: false));
  }

  Future<void> _search(String query, {required bool precise}) async {
    final q = query.trim();
    if (q.length < 3) {
      setState(() { _results = const []; _isError = false; _message = 'Type at least 3 characters'; });
      return;
    }
    _debounce?.cancel();
    _cancel?.cancel();
    final token = _cancel = CancelToken();
    final seq = ++_seq;
    setState(() { _loading = true; _message = null; });
    try {
      final r = await ref.read(geocoderProvider).search(q, near: widget.near?.call(), precise: precise, cancel: token);
      if (!mounted || seq != _seq) return;
      setState(() { _results = r; _isError = false; _message = r.isEmpty ? 'No places found for "$q"' : null; });
    } on DioException catch (e) {
      if (CancelToken.isCancel(e)) return; // superseded by a newer search
    } on SearchException catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() { _results = const []; _isError = true; _message = e.message; });
    } finally {
      if (mounted && seq == _seq) setState(() => _loading = false);
    }
  }

  void _clear() {
    _cancel?.cancel();
    _seq++;
    _controller.clear();
    setState(() { _results = const []; _message = null; _loading = false; });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _cancel?.cancel();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final showPanel = _results.isNotEmpty || _message != null;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Material(
        elevation: 2,
        borderRadius: BorderRadius.circular(24),
        color: Tokens.surface,
        child: Padding(
          padding: const EdgeInsets.only(left: 14),
          child: Row(children: [
            const ExcludeSemantics(child: Icon(Icons.search, color: Tokens.muted)),
            const SizedBox(width: 8),
            Expanded(
              child: Semantics(
                textField: true,
                label: 'Search for a place or address',
                child: TextField(
                  controller: _controller,
                  focusNode: _focus,
                  textInputAction: TextInputAction.search,
                  autocorrect: false,
                  enableSuggestions: false,
                  onChanged: _onChanged,
                  onSubmitted: (v) => _search(v, precise: true),
                  decoration: InputDecoration(
                    hintText: widget.hint,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    filled: false,
                  ),
                ),
              ),
            ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(14),
                child: SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)),
              )
            else if (_controller.text.isNotEmpty)
              IconButton(tooltip: 'Clear search', icon: const Icon(Icons.close), onPressed: _clear),
          ]),
        ),
      ),
      if (showPanel)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Material(
            elevation: 3,
            borderRadius: BorderRadius.circular(16),
            color: Tokens.surface,
            clipBehavior: Clip.antiAlias,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 300),
              child: _results.isEmpty
                  ? Semantics(
                      liveRegion: true,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(children: [
                          Icon(_isError ? Icons.error_outline : Icons.info_outline, color: _isError ? Tokens.danger : Tokens.muted),
                          const SizedBox(width: 12),
                          Expanded(child: Text(_message ?? '', style: TextStyle(color: _isError ? Tokens.danger : Tokens.muted))),
                          if (_isError) TextButton(onPressed: () => _search(_controller.text, precise: true), child: const Text('Retry')),
                        ]),
                      ),
                    )
                  : ListView(
                      shrinkWrap: true,
                      padding: EdgeInsets.zero,
                      children: [
                        for (final p in _results)
                          ListTile(
                            leading: const ExcludeSemantics(child: Icon(Icons.place_outlined, color: Tokens.accent)),
                            title: Text(p.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                            onTap: () {
                              _focus.unfocus();
                              setState(() { _results = const []; _message = null; });
                              widget.onSelected(p);
                            },
                          ),
                        const Padding(
                          padding: EdgeInsets.fromLTRB(16, 4, 16, 10),
                          child: Text('© OpenStreetMap contributors', style: TextStyle(fontSize: 11, color: Tokens.muted)),
                        ),
                      ],
                    ),
            ),
          ),
        ),
    ]);
  }
}