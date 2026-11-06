import 'dart:async';
import 'dart:math' as math;

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:uuid/uuid.dart';

import '../../configs/app_config.dart';
import '../../utils/app_log.dart';
import 'app_exception.dart';

/// Low-level transport: `name -> request map -> response`. Replaced in tests.
typedef ApiTransport = Future<Object?> Function(Map<String, dynamic> request);

/// Client of the single backend callable `api` (CONTRACT §4):
/// `httpsCallable('api')({action, orgId?, campusId?, payload, opId?})` -> `{ok, data}`.
///
/// ```dart
/// final data = await ApiService.to.call(
///   'leave.submit',
///   orgId: s.orgId, campusId: s.campusId,
///   payload: {...},
///   opId: ApiService.newOpId(),   // required for every important write
/// );
/// ```
///
/// Errors are normalised into [AppException]. Retry policy: only calls with
/// `idempotent: true` (pure reads) or an `opId` (server de-duplicates) are
/// retried, and only for network/timeout/internal errors.
class ApiService extends GetxService {
  ApiService({ApiTransport? transport, this.sleep = _defaultSleep})
    : _transport = transport ?? _callableTransport;

  static ApiService get to => Get.find<ApiService>();

  final ApiTransport _transport;

  /// Overridable in tests so retries do not wait.
  final Future<void> Function(Duration) sleep;

  static Future<void> _defaultSleep(Duration d) => Future<void>.delayed(d);

  static const Uuid _uuid = Uuid();

  /// New idempotency key for one user intent. Create it ONCE per intent (when
  /// the form opens or the button is first tapped) and reuse it on retries.
  static String newOpId() => _uuid.v4();

  /// Called when the server says the session is no longer valid.
  void Function()? onUnauthenticated;

  static Future<Object?> _callableTransport(Map<String, dynamic> request) async {
    final callable = FirebaseFunctions.instanceFor(
      region: AppConfig.functionsRegion,
    ).httpsCallable(
      AppConfig.apiFunctionName,
      options: HttpsCallableOptions(timeout: AppConfig.apiTimeout),
    );
    final res = await callable.call<Object?>(request);
    return res.data;
  }

  /// Calls [action] and returns the `data` map. Throws [AppException].
  Future<Map<String, dynamic>> call(
    String action, {
    String? orgId,
    String? campusId,
    Map<String, dynamic> payload = const {},
    String? opId,
    bool idempotent = false,
  }) async {
    final request = <String, dynamic>{
      'action': action,
      'orgId': ?orgId,
      'campusId': ?campusId,
      'payload': payload,
      'opId': ?opId,
    };
    final canRetry = idempotent || opId != null;
    final maxAttempts = canRetry ? AppConfig.apiMaxAttempts : 1;

    AppException? last;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        final raw = await _transport(request);
        return _unwrap(raw);
      } catch (e, st) {
        final ex = normalizeError(e);
        last = ex;
        if (ex.isUnauthenticated) onUnauthenticated?.call();
        final retry = ex.isRetryable && attempt < maxAttempts;
        AppLog.info('api $action attempt $attempt failed: ${ex.code}');
        if (!retry) {
          if (ex.code == AppException.unknown ||
              ex.code == AppException.internal) {
            AppLog.error('api $action', e, st);
          }
          throw ex;
        }
        await sleep(AppConfig.apiRetryBase * math.pow(2, attempt - 1).toInt());
      }
    }
    throw last ?? const AppException(AppException.unknown, '');
  }

  /// `{ok:true, data}` -> `data` (always a `Map<String, dynamic>`).
  @visibleForTesting
  static Map<String, dynamic> unwrapForTest(Object? raw) => _unwrap(raw);

  static Map<String, dynamic> _unwrap(Object? raw) {
    final m = _deepMap(raw);
    if (m == null) {
      throw const AppException(AppException.internal, '');
    }
    if (m['ok'] == false) {
      throw const AppException(AppException.internal, '');
    }
    final data = m.containsKey('data') ? m['data'] : m;
    return _deepMap(data) ?? <String, dynamic>{};
  }

  static Map<String, dynamic>? _deepMap(Object? v) {
    if (v is Map) {
      return v.map((k, val) => MapEntry(k.toString(), _deepValue(val)));
    }
    return null;
  }

  static dynamic _deepValue(Object? v) {
    if (v is Map) return _deepMap(v);
    if (v is List) return v.map(_deepValue).toList();
    return v;
  }

  /// Maps any thrown error to an [AppException].
  static AppException normalizeError(Object e) {
    if (e is AppException) return e;
    if (e is TimeoutException) {
      return const AppException(AppException.timeout, '');
    }
    if (e is FirebaseFunctionsException) {
      final details = _deepMap(e.details) ?? <String, dynamic>{};
      final fieldErrors = <String, String>{};
      final fe = details['fieldErrors'];
      if (fe is Map) {
        fe.forEach((k, v) => fieldErrors[k.toString()] = v.toString());
      }
      final code = details['code']?.toString() ?? _fromGrpc(e.code);
      return AppException(
        code,
        e.message ?? '',
        fieldErrors: fieldErrors,
        details: details,
        requestId: details['requestId']?.toString(),
      );
    }
    final text = e.toString();
    if (text.contains('SocketException') ||
        text.contains('network') ||
        text.contains('Failed host lookup')) {
      return const AppException(AppException.network, '');
    }
    return AppException(AppException.unknown, text);
  }

  static String _fromGrpc(String code) {
    switch (code) {
      case 'permission-denied':
        return AppException.permissionDenied;
      case 'unauthenticated':
        return AppException.unauthenticated;
      case 'not-found':
        return AppException.notFound;
      case 'invalid-argument':
        return AppException.validation;
      case 'aborted':
        return AppException.versionConflict;
      case 'already-exists':
        return AppException.conflict;
      case 'failed-precondition':
        return AppException.precondition;
      case 'resource-exhausted':
        return AppException.limit;
      case 'unavailable':
        return AppException.network;
      case 'deadline-exceeded':
        return AppException.timeout;
      case 'internal':
        return AppException.internal;
      default:
        return AppException.unknown;
    }
  }
}
