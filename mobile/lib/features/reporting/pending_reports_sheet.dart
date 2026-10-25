import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme.dart';
import 'offline_banner.dart';
import 'report_queue.dart';
import 'retry_policy.dart';

/// Reports that are queued, sending, or failed — with live countdowns, progress, Retry now and Discard.
void showPendingReportsSheet(BuildContext context) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Tokens.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    builder: (_) => const _PendingList(),
  );
}

String _fmt(int s) => s < 60 ? '${s}s' : '${(s / 60).ceil()} min';

String _status(PendingReport r, bool online) {
  switch (r.state) {
    case 'uploading':
      return r.progress != null ? 'Sending photo… ${(r.progress! * 100).round()}%' : 'Sending…';
    case 'failed':
      return r.error ?? 'Could not be sent';
    default:
      if (!online) return 'Waiting for a connection';
      final at = r.nextAttemptAt;
      if (at != null) {
        final s = at.difference(DateTime.now()).inSeconds;
        return 'Retrying ${s <= 0 ? 'now' : 'in ${_fmt(s)}'} · try ${r.attempts + 1} of $maxOnlineAttempts';
      }
      return 'Queued';
  }
}

class _PendingList extends ConsumerStatefulWidget {
  const _PendingList();
  @override
  ConsumerState<_PendingList> createState() => _PendingListState();
}

class _PendingListState extends ConsumerState<_PendingList> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {}); // keeps the "retrying in 12s" countdown alive
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _confirmDiscard(PendingReport r) async {
    final ok = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
            title: const Text('Discard this report?'),
            content: Text('"${r.title}" has not been sent. It will be deleted from this phone${r.imagePaths.isEmpty ? '' : ', along with its photos'}.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep it')),
              TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Discard')),
            ],
          ),
        ) ??
        false;
    if (ok) await ref.read(reportQueueProvider.notifier).discard(r.id);
  }

  @override
  Widget build(BuildContext context) {
    final items = ref.watch(reportQueueProvider);
    final online = ref.watch(onlineProvider).valueOrNull ?? true;
    final queue = ref.read(reportQueueProvider.notifier);
    const bigTarget = Size(48, 48);

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(8, 20, 8, 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Semantics(
              header: true,
              child: Text('Waiting to send', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600)),
            ),
          ),
          if (!online)
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 6, 16, 0),
              child: Text("You're offline — these will be sent when you reconnect.", style: TextStyle(color: Tokens.muted)),
            ),
          const SizedBox(height: 8),
          if (items.isEmpty)
            const Padding(padding: EdgeInsets.all(16), child: Text('Everything has been sent.', style: TextStyle(color: Tokens.muted))),
          for (final r in items)
            MergeSemantics(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Padding(
                    padding: const EdgeInsets.only(left: 8, right: 12, top: 4),
                    child: ExcludeSemantics(child: _Thumb(r)),
                  ),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(r.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 2),
                      Text(_status(r, online), style: TextStyle(color: r.state == 'failed' ? Tokens.danger : Tokens.muted, fontSize: 13)),
                      if (r.state == 'uploading') Padding(padding: const EdgeInsets.only(top: 6), child: LinearProgressIndicator(value: r.progress, minHeight: 4)),
                      Row(children: [
                        if (r.state != 'uploading' && (r.state == 'failed' || r.nextAttemptAt != null || online))
                          TextButton(
                            style: TextButton.styleFrom(minimumSize: bigTarget),
                            onPressed: () => queue.retryNow(r.id),
                            child: Text('Retry now', semanticsLabel: 'Retry sending ${r.title} now'),
                          ),
                        TextButton(
                          style: TextButton.styleFrom(minimumSize: bigTarget, foregroundColor: Tokens.danger),
                          onPressed: () => _confirmDiscard(r),
                          child: Text('Discard', semanticsLabel: 'Discard ${r.title}'),
                        ),
                      ]),
                    ]),
                  ),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  final PendingReport r;
  const _Thumb(this.r);
  @override
  Widget build(BuildContext context) {
    final fallback = Container(
      width: 48, height: 48,
      decoration: BoxDecoration(color: Tokens.bg, borderRadius: BorderRadius.circular(12), border: Border.all(color: Tokens.border)),
      child: Icon(categoryIcon(r.category), color: Tokens.muted),
    );
    if (r.imagePaths.isEmpty) return fallback;
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Image.file(File(r.imagePaths.first), width: 48, height: 48, fit: BoxFit.cover, cacheWidth: 96, errorBuilder: (_, __, ___) => fallback),
    );
  }
}