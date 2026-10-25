import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../notifications/push_service.dart';
import '../reporting/report_queue.dart';
import 'auth_controller.dart';
import 'profile_provider.dart';

class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});

  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends ConsumerState<AccountScreen> {
  bool _exporting = false;
  bool _deleting = false;
  bool _signingOut = false;

  void _message(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _export() async {
    if (_exporting) return;
    setState(() => _exporting = true);
    File? file;
    try {
      final response = await ref.read(dioProvider).get('/auth/me/export');
      final directory = await getTemporaryDirectory();
      final timestamp = DateTime.now().toUtc().toIso8601String().replaceAll(RegExp(r'[:.]'), '-');
      file = File('${directory.path}/civiclens-export-$timestamp.json');
      await file.writeAsString(jsonEncode(response.data), flush: true);
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path)],
          subject: 'CivicLens data export',
          text: 'Your CivicLens account data export.',
        ),
      );
    } catch (error) {
      if (mounted) _message(errorMessage(error));
    } finally {
      try {
        if (file != null && await file.exists()) await file.delete();
      } catch (error) {
        debugPrint('Could not clean up temporary data export: $error');
      }
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _signOut() async {
    final queued = ref.read(reportQueueProvider);
    if (queued.isNotEmpty) {
      final discard = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('Unsent reports'),
              content: Text(
                '${queued.length} report${queued.length == 1 ? ' has' : 's have'} not been sent. '
                'Signing out will discard them and their local photos.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext, false),
                  child: const Text('Stay signed in'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(dialogContext, true),
                  child: const Text('Discard and sign out'),
                ),
              ],
            ),
          ) ??
          false;
      if (!discard || !mounted) return;
      await ref.read(reportQueueProvider.notifier).clear();
    }

    setState(() => _signingOut = true);
    await ref.read(pushProvider).unregister();
    await ref.read(authProvider.notifier).logout();
  }

  Future<void> _deleteAccount() async {
    if (_deleting) return;
    final proof = await showDialog<_DeleteProof>(
      context: context,
      builder: (context) => const _DeleteAccountDialog(googleEnabled: googleEnabled),
    );
    if (proof == null || !mounted) return;

    final queued = ref.read(reportQueueProvider);
    if (queued.isNotEmpty) {
      final discard = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('Delete unsent reports too?'),
              content: Text(
                '${queued.length} unsent report${queued.length == 1 ? '' : 's'} and their local photos '
                'belong to this account and will be permanently deleted.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext, false),
                  child: const Text('Cancel deletion'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(dialogContext, true),
                  child: const Text('Delete everything'),
                ),
              ],
            ),
          ) ??
          false;
      if (!discard || !mounted) return;
      await ref.read(reportQueueProvider.notifier).clear();
    }

    setState(() => _deleting = true);
    try {
      await ref.read(pushProvider).unregister();
      await ref.read(authProvider.notifier).deleteAccount(
            password: proof.password,
            googleIdToken: proof.googleIdToken,
          );
    } catch (error) {
      if (mounted) {
        _message(errorMessage(error));
        await ref.read(pushProvider).start();
      }
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(profileProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          profile.when(
            loading: () => const LinearProgressIndicator(),
            error: (error, _) => ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Could not load account details'),
              subtitle: Text(errorMessage(error)),
              trailing: IconButton(
                tooltip: 'Retry',
                onPressed: () => ref.invalidate(profileProvider),
                icon: const Icon(Icons.refresh),
              ),
            ),
            data: (user) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const CircleAvatar(child: Icon(Icons.person_outline)),
              title: Text(user.displayName),
              subtitle: Text(user.email),
            ),
          ),
          const SizedBox(height: 12),
          const Divider(),
          Text('Privacy', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          const Text(
            'Export a copy of your CivicLens data or permanently delete your account and its reports.',
            style: TextStyle(color: Tokens.muted),
          ),
          const SizedBox(height: 8),
          if (privacyPolicyUrl.startsWith('https://'))
            TextButton.icon(
              onPressed: () async {
                try {
                  final opened = await launchUrl(
                    Uri.parse(privacyPolicyUrl),
                    mode: LaunchMode.externalApplication,
                  );
                  if (!opened && mounted) {
                    _message('Could not open the privacy policy.');
                  }
                } catch (error) {
                  if (mounted) {
                    _message('Could not open the privacy policy: $error');
                  }
                }
              },
              icon: const Icon(Icons.privacy_tip_outlined),
              label: const Text('Read the privacy policy'),
            )
          else
            const Text(
              'Privacy policy link will be enabled for release builds.',
              style: TextStyle(color: Tokens.muted),
            ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _exporting ? null : _export,
            icon: _exporting
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.download_outlined),
            label: Text(_exporting ? 'Preparing export…' : 'Export my data'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _deleting ? null : _deleteAccount,
            icon: _deleting
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.delete_forever_outlined),
            label: Text(_deleting ? 'Deleting account…' : 'Delete account'),
            style: OutlinedButton.styleFrom(foregroundColor: Tokens.danger),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: _signingOut || _deleting ? null : _signOut,
            icon: const Icon(Icons.logout),
            label: Text(_signingOut ? 'Signing out…' : 'Sign out'),
          ),
        ],
      ),
    );
  }
}

class _DeleteProof {
  const _DeleteProof({this.password, this.googleIdToken});
  final String? password;
  final String? googleIdToken;
}

class _DeleteAccountDialog extends ConsumerStatefulWidget {
  const _DeleteAccountDialog({required this.googleEnabled});
  final bool googleEnabled;

  @override
  ConsumerState<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends ConsumerState<_DeleteAccountDialog> {
  final _password = TextEditingController();
  bool _googleBusy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _google() async {
    setState(() {
      _googleBusy = true;
      _error = null;
    });
    try {
      final token = await ref.read(authProvider.notifier).googleIdTokenForReauthentication();
      if (token != null && mounted) {
        Navigator.pop(context, _DeleteProof(googleIdToken: token));
      }
    } catch (error) {
      if (mounted) setState(() => _error = errorMessage(error));
    } finally {
      if (mounted) setState(() => _googleBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Delete your account?'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'This permanently deletes your account, reported issues, and attached images. '
                'You will be signed out everywhere. This cannot be undone.',
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _password,
                obscureText: true,
                onChanged: (_) => setState(() {}),
                autofillHints: const [AutofillHints.password],
                decoration: const InputDecoration(labelText: 'Current password'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: const TextStyle(color: Tokens.danger)),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          if (widget.googleEnabled)
            TextButton(
              onPressed: _googleBusy ? null : _google,
              child: Text(_googleBusy ? 'Checking Google…' : 'Re-authenticate with Google'),
            ),
          FilledButton(
            onPressed: _password.text.isEmpty
                ? null
                : () => Navigator.pop(context, _DeleteProof(password: _password.text)),
            style: FilledButton.styleFrom(backgroundColor: Tokens.danger),
            child: const Text('Delete permanently'),
          ),
        ],
      );
}
