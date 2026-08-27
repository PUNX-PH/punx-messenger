import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_config.dart';
import '../config/emulators.dart';
import '../providers/auth_providers.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../theme/palette.dart';
import '../theme/text_styles.dart';

/// Port of components/Login.jsx.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _busy = false;
  String? _error;
  final _emulatorEmail = TextEditingController();

  @override
  void dispose() {
    _emulatorEmail.dispose();
    super.dispose();
  }

  /// Emulator-only. See AuthService.signInAsEmulatorUser — the Google popup
  /// can't complete against the auth emulator in an automated browser.
  Future<void> _onEmulatorSignIn() async {
    final email = _emulatorEmail.text.trim();
    if (email.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    ref.read(sessionEndedReasonProvider.notifier).state = null;
    try {
      await ref.read(authServiceProvider).signInAsEmulatorUser(email);
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'Sign-in failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onSignIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    // Trying again clears whatever ended the last session, so the banner
    // doesn't outlive the attempt it described.
    ref.read(sessionEndedReasonProvider.notifier).state = null;
    try {
      await ref.read(authServiceProvider).signIn();
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'Sign-in failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // A removal signs the user out from under them, so the explanation has to
    // arrive here rather than as a return value from _onSignIn.
    final message = _error ?? ref.watch(sessionEndedReasonProvider);
    return Scaffold(
      backgroundColor: Palette.bgDeepest,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 384),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: Palette.brand,
                        borderRadius: BorderRadius.circular(AppRadii.md),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        'P',
                        style: AppTextStyles.lg(
                          color: Colors.white,
                          weight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Punx Messenger',
                          style: AppTextStyles.base(weight: FontWeight.w600),
                        ),
                        Text(
                          'Internal communication',
                          style: AppTextStyles.xs(color: Palette.inkDim),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 32),
                Text(
                  'Sign in',
                  style: AppTextStyles.lg(
                    weight: FontWeight.w700,
                  ).copyWith(fontSize: 22),
                ),
                const SizedBox(height: 6),
                Text(
                  'Restricted to @${AppConfig.allowedEmailDomain} accounts.',
                  style: AppTextStyles.sm(color: Palette.inkMuted),
                ),
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: _busy ? null : _onSignIn,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: Palette.bgDeepest,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: const [
                            _GoogleG(),
                            SizedBox(width: 10),
                            Text(
                              'Continue with Google',
                              style: TextStyle(fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                ),
                if (message != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Palette.bad.withValues(alpha: 0.1),
                      border: Border.all(
                        color: Palette.bad.withValues(alpha: 0.2),
                      ),
                      borderRadius: BorderRadius.circular(AppRadii.md),
                    ),
                    child: Text(
                      message,
                      style: AppTextStyles.sm(color: Palette.bad),
                    ),
                  ),
                ],
                // Emulator runs only — compiled out of a normal build,
                // because Emulators.enabled is a --dart-define.
                if (Emulators.enabled) ...[
                  const SizedBox(height: 20),
                  Text(
                    'Emulator sign-in',
                    style: AppTextStyles.xs(color: Palette.inkDim),
                  ),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _emulatorEmail,
                    enabled: !_busy,
                    autocorrect: false,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      hintText: 'someone@punx.ai',
                      isDense: true,
                    ),
                    onSubmitted: (_) => _onEmulatorSignIn(),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _busy ? null : _onEmulatorSignIn,
                    child: const Text('Sign in without Google'),
                  ),
                ],
                const SizedBox(height: 24),
                Text(
                  'By signing in you agree to our internal acceptable-use policy.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.xs(color: Palette.inkDim),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _GoogleG extends StatelessWidget {
  const _GoogleG();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 18,
      height: 18,
      child: Text(
        'G',
        style: TextStyle(
          fontWeight: FontWeight.w900,
          color: Color(0xFF4285F4),
          fontSize: 18,
        ),
      ),
    );
  }
}
