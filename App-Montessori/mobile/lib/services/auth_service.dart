import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:get/get.dart';

import '../utils/app_log.dart';
import 'network/app_exception.dart';

/// Thin wrapper over FirebaseAuth. Errors are normalised into [AppException]
/// (`AUTH_INVALID`, `NETWORK`, ...). No password or token is ever logged.
class AuthService extends GetxService {
  static AuthService get to => Get.find<AuthService>();

  FirebaseAuth get _auth => FirebaseAuth.instance;

  User? get currentUser => _auth.currentUser;
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  Future<User> signInWithEmail(String email, String password) async {
    try {
      final cred = await _auth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      return cred.user!;
    } catch (e, st) {
      throw _map(e, st);
    }
  }

  Future<void> sendPasswordReset(String email) async {
    try {
      await _auth.sendPasswordResetEmail(email: email.trim());
    } catch (e, st) {
      final ex = _map(e, st);
      // Do not reveal whether the address has an account.
      if (ex.code == AppException.authInvalid) return;
      throw ex;
    }
  }

  /// Step 1 of phone OTP (parents). Only used when `AppConfig.phoneOtpEnabled`.
  /// Returns the verification id; [onAutoVerified] fires on instant verification.
  Future<String> requestPhoneCode(
    String e164, {
    int? resendToken,
    void Function(PhoneAuthCredential)? onAutoVerified,
    void Function(int?)? onResendToken,
  }) async {
    final completer = Completer<String>();
    await _auth.verifyPhoneNumber(
      phoneNumber: e164,
      forceResendingToken: resendToken,
      timeout: const Duration(seconds: 60),
      verificationCompleted: (c) => onAutoVerified?.call(c),
      verificationFailed: (e) {
        if (!completer.isCompleted) completer.completeError(_map(e, null));
      },
      codeSent: (id, token) {
        onResendToken?.call(token);
        if (!completer.isCompleted) completer.complete(id);
      },
      codeAutoRetrievalTimeout: (id) {
        if (!completer.isCompleted) completer.complete(id);
      },
    );
    return completer.future;
  }

  /// Step 2 of phone OTP.
  Future<User> confirmPhoneCode(String verificationId, String smsCode) async {
    try {
      final cred = await _auth.signInWithCredential(
        PhoneAuthProvider.credential(
          verificationId: verificationId,
          smsCode: smsCode,
        ),
      );
      return cred.user!;
    } catch (e, st) {
      throw _map(e, st);
    }
  }

  Future<void> signOut() => _auth.signOut();

  AppException _map(Object e, StackTrace? st) {
    if (e is AppException) return e;
    if (e is FirebaseAuthException) {
      switch (e.code) {
        case 'invalid-credential':
        case 'wrong-password':
        case 'user-not-found':
        case 'invalid-verification-code':
          return AppException(
            AppException.authInvalid,
            e.code == 'invalid-verification-code'
                ? 'error_otp_invalid'.tr
                : 'error_auth_invalid'.tr,
          );
        case 'invalid-email':
          return AppException(
            AppException.validation,
            'error_email_invalid'.tr,
            fieldErrors: {'email': 'error_email_invalid'.tr},
          );
        case 'user-disabled':
          return AppException(
            AppException.permissionDenied,
            'error_auth_disabled'.tr,
          );
        case 'too-many-requests':
          return AppException(AppException.limit, 'error_auth_too_many'.tr);
        case 'network-request-failed':
          return const AppException(AppException.network, '');
        case 'invalid-phone-number':
          return AppException(
            AppException.validation,
            'error_phone_invalid'.tr,
            fieldErrors: {'phone': 'error_phone_invalid'.tr},
          );
      }
    }
    AppLog.error('auth', e, st);
    return const AppException(AppException.unknown, '');
  }
}
