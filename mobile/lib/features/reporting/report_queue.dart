import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api_client.dart';
import 'retry_policy.dart';

const maxQueuedReports = 20;
const _prefsKeyV2 = 'pending_reports_v2';
const _prefsKeyV1 = 'pending_reports_v1';
const _keep = Object(); // sentinel: "leave this field as it is" in copy()

class QueueFullException implements Exception {
  final String message;
  const QueueFullException(this.message);
}

class _PermanentFailure implements Exception {
  final String message;
  const _PermanentFailure(this.message);
}

/// A report waiting to be delivered. `id` doubles as the server idempotency key (`clientRequestId`),
/// generated BEFORE the first attempt, so any number of retries can never create duplicates.
class PendingReport {
  PendingReport({
    required this.id, required this.category, required this.title, required this.lat, required this.lng,
    this.description, this.imagePaths = const [], this.issueId, this.state = 'pending', this.error,
    this.attempts = 0, this.nextAttemptAt, DateTime? createdAt, this.progress,
  }) : createdAt = createdAt ?? DateTime.now();

  final String id, category, title;
  final String? description;
  final double lat, lng;
  final List<String> imagePaths; // photos still to upload; shrinks as each one succeeds
  final String? issueId; // set once the issue exists server-side
  final String state; // pending | uploading | failed
  final String? error;
  final int attempts; // failures while ONLINE (time spent offline never counts against a report)
  final DateTime? nextAttemptAt;
  final DateTime createdAt;
  final double? progress; // 0..1 for the current photo; in-memory only

  PendingReport copy({
    List<String>? imagePaths, String? issueId, String? state, Object? error = _keep, int? attempts,
    Object? nextAttemptAt = _keep, Object? progress = _keep,
  }) =>
      PendingReport(
        id: id, category: category, title: title, description: description, lat: lat, lng: lng, createdAt: createdAt,
        imagePaths: imagePaths ?? this.imagePaths, issueId: issueId ?? this.issueId, state: state ?? this.state,
        error: identical(error, _keep) ? this.error : error as String?,
        attempts: attempts ?? this.attempts,
        nextAttemptAt: identical(nextAttemptAt, _keep) ? this.nextAttemptAt : nextAttemptAt as DateTime?,
        progress: identical(progress, _keep) ? this.progress : progress as double?,
      );

  Map<String, dynamic> toJson() => {
        'id': id, 'category': category, 'title': title, 'description': description, 'lat': lat, 'lng': lng,
        'imagePaths': imagePaths, 'issueId': issueId, 'state': state, 'error': error, 'attempts': attempts,
        'nextAttemptAt': nextAttemptAt?.toIso8601String(), 'createdAt': createdAt.toIso8601String(),
      };

  factory PendingReport.fromJson(Map<String, dynamic> j) => PendingReport(
        id: j['id'], category: j['category'], title: j['title'], description: j['description'],
        lat: (j['lat'] as num).toDouble(), lng: (j['lng'] as num).toDouble(),
        imagePaths: List<String>.from(j['imagePaths'] ?? const []), issueId: j['issueId'],
        // an app killed mid-upload comes back as "pending", never stuck "uploading"
        state: j['state'] == 'failed' ? 'failed' : 'pending', error: j['error'],
        attempts: (j['attempts'] as int?) ?? 0,
        nextAttemptAt: j['nextAttemptAt'] == null ? null : DateTime.tryParse(j['nextAttemptAt']),
        createdAt: j['createdAt'] == null ? null : DateTime.tryParse(j['createdAt']),
      );
}

/// Set to the title of the report that was just delivered, so the UI can say "Sent".
final lastSentProvider = StateProvider<String?>((_) => null);

enum _Next { carryOn, stop }

class ReportQueue extends Notifier<List<PendingReport>> {
  bool _flushing = false;
  bool _online = true;

  @override
  List<PendingReport> build() {
    _load();
    Connectivity().checkConnectivity().then((r) => _online = !r.contains(ConnectivityResult.none));
    final sub = Connectivity().onConnectivityChanged.listen((r) {
      final wasOnline = _online;
      _online = !r.contains(ConnectivityResult.none);
      if (_online && !wasOnline) {
        // Back online: forget the backoff timers (they were for a different situation) and go straight away.
        state = [for (final x in state) x.state == 'failed' ? x : x.copy(nextAttemptAt: null)];
        flush(force: true);
      }
    });
    final ticker = Timer.periodic(const Duration(seconds: 15), (_) => flush()); // picks up reports whose retry time has come
    ref.onDispose(() {
      sub.cancel();
      ticker.cancel();
    });
    return const [];
  }

  // ───────── persistence ─────────

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKeyV2) ?? prefs.getString(_prefsKeyV1); // v1 (older app) migrates automatically
    if (raw == null) return;
    try {
      state = [for (final j in jsonDecode(raw) as List) PendingReport.fromJson(Map<String, dynamic>.from(j))];
      flush(force: true);
    } catch (_) {/* corrupt data must never crash the app */}
  }

  Future<void> _persist() async => (await SharedPreferences.getInstance())
      .setString(_prefsKeyV2, jsonEncode([for (final r in state) r.toJson()]));

  PendingReport? _byId(String id) {
    for (final r in state) {
      if (r.id == id) return r;
    }
    return null;
  }

  void _put(PendingReport r) => state = [for (final x in state) x.id == r.id ? r : x];

  Future<void> _deleteFiles(Iterable<String> paths) async {
    for (final p in paths) {
      try {
        await File(p).delete();
      } catch (_) {/* already gone */}
    }
  }

  // ───────── public API ─────────

  Future<void> add(PendingReport r) async {
    if (state.length >= maxQueuedReports) {
      throw const QueueFullException('Too many unsent reports. Reconnect so they can be sent, or discard some first.');
    }
    state = [...state, r];
    await _persist();
    flush(force: true);
  }

  /// "Retry now": clears the failure count and the wait.
  Future<void> retryNow(String id) async {
    final r = _byId(id);
    if (r == null) return;
    _put(r.copy(state: 'pending', error: null, attempts: 0, nextAttemptAt: null));
    await _persist();
    flush(force: true);
  }

  Future<void> discard(String id) async {
    final r = _byId(id);
    state = state.where((x) => x.id != id).toList();
    await _persist();
    if (r != null) await _deleteFiles(r.imagePaths);
  }

  Future<void> clear() async {
    final paths = [for (final r in state) ...r.imagePaths];
    state = const [];
    await _persist();
    await _deleteFiles(paths);
  }

  // ───────── delivery ─────────

  /// Safe to call at any time and any number of times.
  Future<void> flush({bool force = false}) async {
    if (_flushing || !_online) return;
    _flushing = true;
    try {
      for (final r in List.of(state)) {
        final cur = _byId(r.id);
        if (cur == null || cur.state == 'failed') continue;
        if (!force && cur.nextAttemptAt != null && DateTime.now().isBefore(cur.nextAttemptAt!)) continue;
        if (await _deliver(cur) == _Next.stop) break;
      }
    } finally {
      _flushing = false;
    }
  }

  Future<_Next> _deliver(PendingReport r) async {
    final dio = ref.read(dioProvider);
    try {
      _put(r.copy(state: 'uploading', error: null, progress: null, nextAttemptAt: null));
      var cur = _byId(r.id)!;

      if (cur.issueId == null) {
        final res = await dio.post('/issues', data: {
          'category': cur.category, 'title': cur.title,
          if (cur.description != null && cur.description!.isNotEmpty) 'description': cur.description,
          'latitude': cur.lat, 'longitude': cur.lng, 'clientRequestId': cur.id,
        });
        cur = cur.copy(issueId: res.data['id'] as String);
        _put(cur);
        await _persist(); // the issue exists server-side now: a crash from here on must not create it twice
      }

      for (final path in List.of(cur.imagePaths)) {
        if (await File(path).exists()) {
          await _uploadImage(dio, cur.issueId!, path, (p) => _progress(r.id, p));
        } // a photo the OS cleaned up is skipped rather than blocking the report forever
        cur = cur.copy(imagePaths: cur.imagePaths.where((x) => x != path).toList(), progress: null);
        _put(cur);
        await _persist();
      }

      state = state.where((x) => x.id != r.id).toList();
      await _persist();
      ref.read(lastSentProvider.notifier).state = cur.title;
      return _Next.carryOn;
    } on DioException catch (e) {
      return _failed(r.id, statusCode: e.response?.statusCode, message: errorMessage(e));
    } on _PermanentFailure catch (e) {
      return _failed(r.id, statusCode: 422, message: e.message);
    } catch (e) {
      return _failed(r.id, statusCode: 422, message: 'Could not send: $e');
    }
  }

  _Next _failed(String id, {int? statusCode, required String message}) {
    final cur = _byId(id);
    if (cur == null) return _Next.carryOn;

    if (!_online) {
      // Offline is not the report's fault: wait quietly, don't use up a retry, try again the moment we reconnect.
      _put(cur.copy(state: 'pending', error: 'Waiting for a connection', nextAttemptAt: null, progress: null));
      unawaited(_persist());
      return _Next.stop;
    }

    final attempts = cur.attempts + 1;
    final permanent = classifyFailure(statusCode: statusCode) == FailureKind.permanent;
    if (permanent || attempts >= maxOnlineAttempts) {
      _put(cur.copy(
        state: 'failed', attempts: attempts, nextAttemptAt: null, progress: null,
        error: permanent ? message : 'Gave up after $attempts tries. $message',
      ));
      unawaited(_persist());
      return _Next.carryOn; // one bad report must not block the others
    }

    _put(cur.copy(
      state: 'pending', attempts: attempts, error: message, progress: null,
      nextAttemptAt: DateTime.now().add(backoffDelay(attempts)),
    ));
    unawaited(_persist());
    return _Next.stop; // the network/server is struggling: don't hammer it with the rest
  }

  void _progress(String id, double p) {
    final cur = _byId(id);
    if (cur == null) return;
    if (p >= 1 || (p - (cur.progress ?? 0)).abs() >= 0.05) _put(cur.copy(progress: p)); // throttled: no rebuild storm
  }

  Future<void> _uploadImage(Dio dio, String issueId, String path, void Function(double) onProgress) async {
    final bytes = await File(path).readAsBytes();
    if (bytes.length > 5 * 1024 * 1024) throw const _PermanentFailure('A photo is larger than 5 MB.');
    final ct = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    final slot = (await dio.post('/uploads/presign', data: {'contentType': ct, 'sizeBytes': bytes.length})).data;
    // Straight to object storage with the short-lived URL: no storage credentials ever reach the device.
    await Dio().put(slot['uploadUrl'] as String,
        data: bytes,
        options: Options(headers: {'Content-Type': ct, 'Content-Length': bytes.length}),
        onSendProgress: (sent, total) => total > 0 ? onProgress(sent / total) : null);
    final img = await ui.instantiateImageCodec(bytes).then((c) => c.getNextFrame()).then((f) => f.image);
    await dio.post('/issues/$issueId/images', data: {'key': slot['key'], 'width': img.width, 'height': img.height});
    await _deleteFiles([path]); // sent: free the phone's storage
  }
}

final reportQueueProvider = NotifierProvider<ReportQueue, List<PendingReport>>(ReportQueue.new);