import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/theme.dart';
import '../../core/api_client.dart';
import 'notifications_provider.dart';

String timeAgo(DateTime t) {
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes} min ago';
  if (d.inHours < 24) return '${d.inHours} h ago';
  if (d.inDays < 7) return '${d.inDays} d ago';
  return '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
}

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(notificationsProvider.notifier).refresh());
  }

  /// Marks the notification read and opens the complete report details.
  Future<void> _open(AppNotification n) async {
    await ref.read(notificationsProvider.notifier).markRead(n.id);
    final issueId = n.issueId;
    if (issueId == null) return;
    try {
      if (mounted) await context.push('/issues/$issueId');
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('This report is no longer available.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(notificationsProvider);
    final unread = ref.watch(unreadCountProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          IconButton(
            tooltip: 'Mark all as read',
            onPressed: unread == 0 ? null : () => ref.read(notificationsProvider.notifier).markAllRead(),
            icon: const Icon(Icons.done_all),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(notificationsProvider.notifier).refresh(),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            Padding(
              padding: const EdgeInsets.all(32),
              child: Column(children: [
                const Icon(Icons.cloud_off_outlined, size: 40, color: Tokens.muted),
                const SizedBox(height: 12),
                Text(errorMessage(e), textAlign: TextAlign.center, style: const TextStyle(color: Tokens.muted)),
                const SizedBox(height: 12),
                TextButton(onPressed: () => ref.invalidate(notificationsProvider), child: const Text('Try again')),
              ]),
            ),
          ]),
          data: (s) => s.items.isEmpty
              ? ListView(children: const [
                  Padding(
                    padding: EdgeInsets.all(48),
                    child: Column(children: [
                      Icon(Icons.notifications_none, size: 48, color: Tokens.muted),
                      SizedBox(height: 12),
                      Text('Nothing yet', style: TextStyle(fontWeight: FontWeight.w600)),
                      SizedBox(height: 4),
                      Text(
                        'You\'ll hear about status changes and confirmations on reports you made or follow.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Tokens.muted),
                      ),
                    ]),
                  ),
                ])
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  itemCount: s.items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1, color: Tokens.border),
                  itemBuilder: (_, i) {
                    final n = s.items[i];
                    final isConfirm = n.type == 'CONFIRMED';
                    return ListTile(
                      onTap: () => _open(n),
                      tileColor: n.read ? null : Tokens.accent.withValues(alpha: 0.06),
                      leading: CircleAvatar(
                        backgroundColor: (isConfirm ? Tokens.warning : Tokens.accent).withValues(alpha: 0.15),
                        child: Icon(isConfirm ? Icons.groups_outlined : Icons.update,
                            color: isConfirm ? Tokens.warning : Tokens.accent),
                      ),
                      title: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.w500 : FontWeight.w700)),
                      subtitle: Text('${n.body}\n${timeAgo(n.updatedAt)}'),
                      isThreeLine: true,
                      trailing: n.read ? null : const Icon(Icons.circle, size: 10, color: Tokens.accent),
                    );
                  },
                ),
        ),
      ),
    );
  }
}