import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme.dart';
import 'report_queue.dart';

/// True while the device has *some* network. (A captive Wi-Fi can still fail — the retry policy covers that.)
final onlineProvider = StreamProvider<bool>((ref) async* {
  final c = Connectivity();
  yield !(await c.checkConnectivity()).contains(ConnectivityResult.none);
  await for (final r in c.onConnectivityChanged) {
    yield !r.contains(ConnectivityResult.none);
  }
});

class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final online = ref.watch(onlineProvider).valueOrNull ?? true;
    if (online) return const SizedBox.shrink();
    final pending = ref.watch(reportQueueProvider).length;
    final text = pending == 0
        ? "You're offline. You can still look around — new reports are saved and sent later."
        : "You're offline. $pending report${pending == 1 ? '' : 's'} will be sent when you reconnect.";

    return Semantics(
      liveRegion: true, // screen readers announce it the moment it appears
      child: SizedBox(
        width: double.infinity,
        child: Material(
          color: Tokens.text,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(children: [
              const ExcludeSemantics(child: Icon(Icons.wifi_off, color: Colors.white)),
              const SizedBox(width: 10),
              Expanded(child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 13))),
            ]),
          ),
        ),
      ),
    );
  }
}