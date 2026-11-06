import 'dart:async';
import 'dart:io' show Platform;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:get/get.dart';
import 'package:uuid/uuid.dart';

import '../configs/pref_const.dart';
import '../configs/pref_defaults.dart';
import '../utils/app_log.dart';
import 'storage/pref_store.dart';

/// Background isolate entry point. Push payloads carry no health/money detail
/// (CONTRACT §6); nothing to do here until a feature needs it.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {}

/// FCM registration: stores the device token at
/// `users/{uid}/devices/{deviceId}` = `{fcmToken, platform, orgId?, updatedAt}`
/// (client-writable per CONTRACT §3). Notification taps are exposed through
/// [opened] so a feature can route to its screen.
class PushService extends GetxService {
  static PushService get to => Get.find<PushService>();

  final Rxn<RemoteMessage> opened = Rxn<RemoteMessage>();
  final Rxn<RemoteMessage> foreground = Rxn<RemoteMessage>();

  String? _uid;
  String? _orgId;
  StreamSubscription<String>? _tokenSub;
  StreamSubscription<RemoteMessage>? _fgSub;
  StreamSubscription<RemoteMessage>? _openSub;

  String get deviceId {
    var id = PrefStore.getString(PrefConst.deviceId, PrefDefaults.deviceId);
    if (id.isEmpty) {
      id = const Uuid().v4();
      PrefStore.setString(PrefConst.deviceId, id);
    }
    return id;
  }

  /// Ask for permission (Android 13+/iOS) and register the token for [uid].
  /// Never throws: push is optional.
  Future<void> register(String uid, {String? orgId}) async {
    _uid = uid;
    _orgId = orgId;
    try {
      final fm = FirebaseMessaging.instance;
      await fm.requestPermission();
      final token = await fm.getToken();
      if (token != null) await _save(token);
      _tokenSub ??= fm.onTokenRefresh.listen(_save);
      _fgSub ??= FirebaseMessaging.onMessage.listen((m) => foreground.value = m);
      _openSub ??= FirebaseMessaging.onMessageOpenedApp.listen(
        (m) => opened.value = m,
      );
    } catch (e, st) {
      AppLog.error('push register', e, st);
    }
  }

  /// Update which org the device belongs to (after a context switch).
  Future<void> setOrg(String? orgId) async {
    _orgId = orgId;
    final uid = _uid;
    if (uid == null) return;
    try {
      await FirebaseFirestore.instance
          .doc('users/$uid/devices/$deviceId')
          .set({'orgId': orgId, 'updatedAt': FieldValue.serverTimestamp()},
              SetOptions(merge: true));
    } catch (e, st) {
      AppLog.error('push setOrg', e, st);
    }
  }

  /// Call BEFORE sign-out so the device stops receiving this user's pushes.
  Future<void> unregister() async {
    final uid = _uid;
    _uid = null;
    _orgId = null;
    await _tokenSub?.cancel();
    _tokenSub = null;
    if (uid == null) return;
    try {
      await FirebaseFirestore.instance
          .doc('users/$uid/devices/$deviceId')
          .delete();
      await FirebaseMessaging.instance.deleteToken();
    } catch (e, st) {
      AppLog.error('push unregister', e, st);
    }
  }

  Future<void> _save(String token) async {
    final uid = _uid;
    if (uid == null) return;
    await FirebaseFirestore.instance.doc('users/$uid/devices/$deviceId').set({
      'fcmToken': token,
      'platform': Platform.isIOS ? 'ios' : 'android',
      'orgId': _orgId,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  @override
  void onClose() {
    _tokenSub?.cancel();
    _fgSub?.cancel();
    _openSub?.cancel();
    super.onClose();
  }
}
