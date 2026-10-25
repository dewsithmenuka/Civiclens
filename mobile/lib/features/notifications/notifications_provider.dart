import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../auth/auth_controller.dart';

class AppNotification {
  final String id, type, title, body;
  final String? issueId;
  final int count;
  final bool read;
  final DateTime updatedAt;

  const AppNotification({
    required this.id, required this.type, required this.title, required this.body,
    required this.count, required this.read, required this.updatedAt, this.issueId,
  });

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: j['id'] as String,
        type: j['type'] as String,
        title: j['title'] as String,
        body: j['body'] as String,
        issueId: j['issueId'] as String?,
        count: j['count'] as int,
        read: j['read'] as bool,
        updatedAt: DateTime.parse(j['updatedAt'] as String),
      );

  AppNotification asRead() => AppNotification(
        id: id, type: type, title: title, body: body, issueId: issueId,
        count: count, read: true, updatedAt: updatedAt,
      );
}

class NotificationsState {
  final List<AppNotification> items;
  final int unreadCount;
  const NotificationsState({required this.items, required this.unreadCount});
}

/// Inbox state. Polls quietly every 45 s while something is watching it (the map's bell badge does).
/// Push notifications (next chunk) will trigger an immediate refresh instead of waiting for the poll.
class NotificationsNotifier extends AutoDisposeAsyncNotifier<NotificationsState> {
  @override
  Future<NotificationsState> build() async {
    ref.watch(authProvider); // different user signed in → rebuild and refetch
    final timer = Timer.periodic(const Duration(seconds: 45), (_) => refresh());
    ref.onDispose(timer.cancel);
    return _fetch();
  }

  Future<NotificationsState> _fetch() async {
    final r = await ref.read(dioProvider).get('/notifications', queryParameters: {'limit': 50});
    final d = Map<String, dynamic>.from(r.data as Map);
    return NotificationsState(
      items: [for (final j in d['items'] as List) AppNotification.fromJson(Map<String, dynamic>.from(j as Map))],
      unreadCount: d['unreadCount'] as int,
    );
  }

  /// Background refresh: errors are ignored so a flaky network never wipes the list the user is looking at.
  Future<void> refresh() async {
    final next = await AsyncValue.guard(_fetch);
    if (next.hasValue) state = next;
  }

  Future<void> markRead(String id) async {
    final cur = state.valueOrNull;
    if (cur == null) return;
    final wasUnread = cur.items.any((n) => n.id == id && !n.read);
    if (!wasUnread) return;
    // Optimistic update so the badge reacts instantly.
    state = AsyncData(NotificationsState(
      items: [for (final n in cur.items) n.id == id ? n.asRead() : n],
      unreadCount: (cur.unreadCount - 1).clamp(0, 1 << 30),
    ));
    try {
      await ref.read(dioProvider).post('/notifications/$id/read');
    } catch (_) {
      await refresh(); // roll back to the server's truth
    }
  }

  Future<void> markAllRead() async {
    final cur = state.valueOrNull;
    if (cur == null || cur.unreadCount == 0) return;
    state = AsyncData(NotificationsState(items: [for (final n in cur.items) n.asRead()], unreadCount: 0));
    try {
      await ref.read(dioProvider).post('/notifications/read-all');
    } catch (_) {
      await refresh();
    }
  }
}

final notificationsProvider =
    AsyncNotifierProvider.autoDispose<NotificationsNotifier, NotificationsState>(NotificationsNotifier.new);

final unreadCountProvider = Provider.autoDispose<int>(
  (ref) => ref.watch(notificationsProvider).valueOrNull?.unreadCount ?? 0,
);