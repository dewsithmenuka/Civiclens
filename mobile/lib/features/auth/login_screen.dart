import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import 'auth_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController(),
      _password = TextEditingController(),
      _name = TextEditingController();
  bool _register = false, _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = ref.read(authProvider.notifier);
      _register
          ? await auth.register(
              _email.text.trim(), _password.text, _name.text.trim())
          : await auth.login(_email.text.trim(), _password.text);
    } catch (e) {
      setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _google() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(authProvider.notifier)
          .loginWithGoogle(); // false = user cancelled: nothing to show
    } on PlatformException catch (e) {
      final msg = _googleMessage(e);
      if (mounted && msg != null) setState(() => _error = msg);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Turns Google's cryptic native errors into something fixable. Returns null when the user just cancelled.
  String? _googleMessage(PlatformException e) {
    final text = '${e.code} ${e.message}';
    if (e.code == 'sign_in_canceled') {
      return null;
    }
    if (e.code == 'network_error') {
      return 'No connection — check your internet and try again.';
    }
    if (text.contains('ApiException: 10')) {
      return 'Google sign-in is not set up for this build (client ID or SHA-1 mismatch).';
    }
    if (text.contains('12500')) {
      return 'Google sign-in failed. Check the OAuth consent screen setup.';
    }
    return 'Google sign-in failed (${e.code}).';
  }

  void _forgotPassword() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Tokens.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      builder: (ctx) => Padding(
        // lift the sheet above the keyboard
        padding: EdgeInsets.fromLTRB(
            24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 24),
        child: _ForgotPasswordForm(initialEmail: _email.text.trim()),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<int>(sessionExpiredProvider, (previous, current) {
      if (previous == null || current == previous) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Your session expired. Sign in again to continue.')),
      );
    });

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(Icons.location_searching,
                        size: 40, color: Tokens.accent),
                    const SizedBox(height: 16),
                    Text('CivicLens',
                        style: Theme.of(context)
                            .textTheme
                            .headlineMedium
                            ?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    const Text("See what's happening. Make it visible.",
                        style: TextStyle(color: Tokens.muted)),
                    const SizedBox(height: 32),
                    if (_register) ...[
                      TextField(
                          controller: _name,
                          decoration:
                              const InputDecoration(labelText: 'Display name')),
                      const SizedBox(height: 12),
                    ],
                    TextField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        decoration: const InputDecoration(labelText: 'Email')),
                    const SizedBox(height: 12),
                    TextField(
                        controller: _password,
                        obscureText: true,
                        autofillHints: const [AutofillHints.password],
                        decoration: InputDecoration(
                            labelText: 'Password',
                            helperText:
                                _register ? 'At least 10 characters' : null)),
                    if (!_register)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                            onPressed: _forgotPassword,
                            child: const Text('Forgot password?')),
                      ),
                    if (_error != null)
                      Padding(
                          padding: const EdgeInsets.only(top: 4, bottom: 8),
                          child: Text(_error!,
                              style: const TextStyle(color: Tokens.danger))),
                    const SizedBox(height: 8),
                    FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : Text(_register ? 'Create account' : 'Sign in')),
                    if (googleEnabled) ...[
                      const SizedBox(height: 16),
                      const Row(children: [
                        Expanded(child: Divider(color: Tokens.border)),
                        Padding(
                            padding: EdgeInsets.symmetric(horizontal: 12),
                            child: Text('or',
                                style: TextStyle(color: Tokens.muted))),
                        Expanded(child: Divider(color: Tokens.border)),
                      ]),
                      const SizedBox(height: 16),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _google,
                        icon: const Icon(Icons.g_mobiledata, size: 30),
                        label: const Text('Continue with Google'),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(52),
                          foregroundColor: Tokens.text,
                          side: const BorderSide(color: Tokens.border),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16)),
                        ),
                      ),
                    ],
                    TextButton(
                        onPressed: () => setState(() => _register = !_register),
                        child: Text(_register
                            ? 'I already have an account'
                            : 'Create an account')),
                  ]),
            ),
          ),
        ),
      ),
    );
  }
}

class _ForgotPasswordForm extends ConsumerStatefulWidget {
  final String initialEmail;
  const _ForgotPasswordForm({required this.initialEmail});
  @override
  ConsumerState<_ForgotPasswordForm> createState() =>
      _ForgotPasswordFormState();
}

class _ForgotPasswordFormState extends ConsumerState<_ForgotPasswordForm> {
  late final _email = TextEditingController(text: widget.initialEmail);
  bool _busy = false, _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      setState(() => _error = 'Enter the email you signed up with.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(dioProvider)
          .post('/auth/forgot-password', data: {'email': email});
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_sent) {
      return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.mark_email_read_outlined,
                size: 40, color: Tokens.accent),
            const SizedBox(height: 12),
            Text('Check your email',
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            const Text(
              'If an account exists for that address, a reset link is on its way. It works for 30 minutes.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Tokens.muted),
            ),
            const SizedBox(height: 16),
            FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Done')),
          ]);
    }
    return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Reset your password',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          const Text("We'll email you a link to choose a new one.",
              style: TextStyle(color: Tokens.muted)),
          const SizedBox(height: 16),
          TextField(
            controller: _email,
            autofocus: true,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email'),
            onSubmitted: (_) => _send(),
          ),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!,
                    style: const TextStyle(color: Tokens.danger))),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _send,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Send reset link'),
          ),
        ]);
  }
}
