import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme.dart';
import '../../core/api_client.dart';
import 'profile_provider.dart';

/// Shown on the map while the user's email is unverified. Renders nothing once verified.
class VerifyEmailBanner extends ConsumerStatefulWidget {
  const VerifyEmailBanner({super.key});
  @override
  ConsumerState<VerifyEmailBanner> createState() => _VerifyEmailBannerState();
}

class _VerifyEmailBannerState extends ConsumerState<VerifyEmailBanner> {
  bool _sending = false;

  Future<void> _resend() async {
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(dioProvider).post('/auth/verify-email/resend');
      messenger.showSnackBar(const SnackBar(content: Text('Verification email sent — check your inbox')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(profileProvider).valueOrNull;
    if (profile == null || profile.emailVerified) return const SizedBox.shrink();

    return SizedBox(
      width: double.infinity,
      child: Material(
        elevation: 2,
        color: const Color(0xFFFFF4DC),
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 8, 6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.mark_email_unread_outlined, color: Tokens.warning),
              const SizedBox(width: 10),
              Expanded(
                child: Text('Verify ${profile.email} to keep reporting.',
                    style: const TextStyle(fontSize: 13, color: Tokens.text)),
              ),
            ]),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              TextButton(
                onPressed: () => ref.invalidate(profileProvider),
                child: const Text("I've verified"),
              ),
              TextButton(
                onPressed: _sending ? null : _resend,
                child: Text(_sending ? 'Sending…' : 'Resend email'),
              ),
            ]),
          ]),
        ),
      ),
    );
  }
}