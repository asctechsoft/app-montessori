import 'package:get/get.dart';

/// Normalised backend/network error (CONTRACT §4: `details.code`, `fieldErrors`).
class AppException implements Exception {
  const AppException(
    this.code,
    this.message, {
    this.fieldErrors = const {},
    this.details = const {},
    this.requestId,
  });

  // Codes from the contract.
  static const String permissionDenied = 'PERMISSION_DENIED';
  static const String unauthenticated = 'UNAUTHENTICATED';
  static const String notFound = 'NOT_FOUND';
  static const String validation = 'VALIDATION';
  static const String versionConflict = 'VERSION_CONFLICT';
  static const String conflict = 'CONFLICT';
  static const String precondition = 'PRECONDITION';
  static const String invalidState = 'INVALID_STATE';
  static const String limit = 'LIMIT';
  static const String internal = 'INTERNAL';

  // Client-side codes.
  static const String network = 'NETWORK';
  static const String timeout = 'TIMEOUT';
  static const String authInvalid = 'AUTH_INVALID';
  static const String unknown = 'UNKNOWN';

  final String code;

  /// Server message (Vietnamese, no stack) or a localized client message.
  final String message;

  /// `{field: message}` for validation errors; map them onto form fields.
  final Map<String, String> fieldErrors;

  /// Raw `details` (e.g. `reason`, lists for PRECONDITION). Never log it.
  final Map<String, dynamic> details;

  /// Support code shown to the user on load errors, when the server sent one.
  final String? requestId;

  bool get isNetwork => code == network || code == timeout;
  bool get isUnauthenticated => code == unauthenticated;
  bool get isForbidden => code == permissionDenied;
  bool get isValidation => code == validation && fieldErrors.isNotEmpty;
  bool get isVersionConflict => code == versionConflict;

  /// Safe to retry automatically (never for business rejections).
  bool get isRetryable => code == network || code == timeout || code == internal;

  /// Text for the user: the server message for business errors, a localized
  /// generic message for transport/internal errors.
  String get userMessage {
    switch (code) {
      case network:
        return 'error_network'.tr;
      case timeout:
        return 'error_timeout'.tr;
      case internal:
      case unknown:
        return 'error_generic'.tr;
      case unauthenticated:
        return 'error_session_expired'.tr;
      default:
        return message.isNotEmpty ? message : 'error_generic'.tr;
    }
  }

  @override
  String toString() => 'AppException($code: $message)';
}
