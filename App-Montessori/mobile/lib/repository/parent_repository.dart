import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:get/get.dart';

import '../models/data_models/parent_models.dart';
import '../services/network/app_exception.dart';
import 'firestore_repository.dart';

typedef Query2 = Query<Map<String, dynamic>>;

/// Firestore READS of the parent role (CONTRACT §5). Every query filters by
/// `childId` / `uid` / `participants` (what the rules require for parents).
/// Writes go through `ApiService` in the controllers, never here (except the
/// Storage upload of a receipt, which CONTRACT §Storage allows for parents).
///
/// Methods are one-shot reads (server first, cache offline) and may be
/// overridden by a fake in tests.
class ParentRepository extends FirestoreRepository {
  ParentRepository({super.db, super.session});

  static ParentRepository get to => Get.isRegistered<ParentRepository>()
      ? Get.find<ParentRepository>()
      : Get.put(ParentRepository());

  Future<DataSnapshot<T>> _byChild<T>(
    String name,
    String childId,
    T Function(String, Map<String, dynamic>) fromMap, {
    Query2 Function(Query2 q)? extra,
    int? limit,
  }) => getCollection<T>(
    name,
    fromMap: fromMap,
    campusScoped: false,
    limit: limit,
    build: (q) {
      var r = q.where('childId', isEqualTo: childId);
      if (extra != null) r = extra(r);
      return r;
    },
  );

  Future<DataSnapshot<HandoverInfo>> handoverOn(String childId, String dayKey) =>
      _byChild('handovers', childId, HandoverInfo.fromMap,
          extra: (q) => q.where('dayKey', isEqualTo: dayKey));

  Future<DataSnapshot<AttendanceInfo>> attendanceOn(String childId, String dayKey) =>
      _byChild('attendance', childId, AttendanceInfo.fromMap,
          extra: (q) => q.where('dayKey', isEqualTo: dayKey));

  /// Published logs of the given days (equality + whereIn: no composite index).
  Future<DataSnapshot<DailyLog>> publishedLogs(String childId, List<String> dayKeys) =>
      _byChild('dailyLogs', childId, DailyLog.fromMap,
          extra: (q) => q
              .where('status', isEqualTo: 'published')
              .where('dayKey', whereIn: dayKeys));

  Future<DataSnapshot<MenuDay>> publishedMenu(String dayKey) => getCollection<MenuDay>(
    'menus',
    fromMap: MenuDay.fromMap,
    build: (q) => q.where('status', isEqualTo: 'published').where('dayKey', isEqualTo: dayKey),
  );

  Future<DataSnapshot<LeaveRequest>> leaves(String childId) =>
      _byChild('leaveRequests', childId, LeaveRequest.fromMap, limit: 100);

  Future<DataSnapshot<PickupAuth>> pickupAuths(String childId) =>
      _byChild('pickupAuthorizations', childId, PickupAuth.fromMap, limit: 100);

  Future<DataSnapshot<MedicationRequest>> medications(String childId) =>
      _byChild('medicationRequests', childId, MedicationRequest.fromMap, limit: 100);

  Future<DataSnapshot<HealthRecord>> healthRecords(String childId) =>
      _byChild('healthRecords', childId, HealthRecord.fromMap, limit: 100);

  Future<DataSnapshot<Receivable>> receivables(String childId) =>
      _byChild('receivables', childId, Receivable.fromMap, limit: 60);

  Future<DataSnapshot<PaymentRecord>> payments(String childId) =>
      _byChild('payments', childId, PaymentRecord.fromMap, limit: 60);

  /// `children/{id}/private/health`; empty list when the doc does not exist.
  Future<DataSnapshot<ChildHealth>> childHealth(String childId) async {
    try {
      final s = await db.doc('orgs/$orgId/children/$childId/private/health').get();
      return DataSnapshot<ChildHealth>(
        s.exists && s.data() != null ? [ChildHealth.fromMap(s.data()!)] : [],
        fromCache: s.metadata.isFromCache,
        receivedAt: DateTime.now(),
      );
    } catch (e) {
      throw FirestoreRepository.mapError(e);
    }
  }

  Future<DataSnapshot<ChildProfile>> childProfile(String childId) async {
    try {
      final s = await orgDoc('children', childId).get();
      return DataSnapshot<ChildProfile>(
        s.exists && s.data() != null ? [ChildProfile.fromMap(s.id, s.data()!)] : [],
        fromCache: s.metadata.isFromCache,
        receivedAt: DateTime.now(),
      );
    } catch (e) {
      throw FirestoreRepository.mapError(e);
    }
  }

  /// School bank account (optional `campuses/{id}.bankAccount`).
  Future<BankInfo> bankInfo() async {
    try {
      final s = await orgDoc('campuses', campusId).get();
      return s.data() == null ? const BankInfo() : BankInfo.fromCampus(s.data()!);
    } catch (e) {
      throw FirestoreRepository.mapError(e);
    }
  }

  Future<DataSnapshot<NotificationItem>> notifications(String uid) =>
      getCollection<NotificationItem>(
        'notificationReceipts',
        fromMap: NotificationItem.fromReceipt,
        campusScoped: false,
        limit: 100,
        build: (q) => q.where('uid', isEqualTo: uid),
      );

  /// Body of one notification (readable once a receipt exists).
  Future<String> notificationBody(String id) async {
    try {
      final s = await orgDoc('notifications', id).get();
      return (s.data()?['body'] ?? '').toString();
    } catch (e) {
      throw FirestoreRepository.mapError(e);
    }
  }

  Future<DataSnapshot<ThreadInfo>> threads(String uid) => getCollection<ThreadInfo>(
    'threads',
    fromMap: ThreadInfo.fromMap,
    campusScoped: false,
    limit: 100,
    build: (q) => q.where('participants', arrayContains: uid),
  );

  Future<DataSnapshot<ThreadMessage>> messages(String threadId) async {
    try {
      final s = await orgDoc('threads', threadId)
          .collection('messages')
          .orderBy('at')
          .limit(200)
          .get();
      return DataSnapshot<ThreadMessage>(
        s.docs.map((d) => ThreadMessage.fromMap(d.id, d.data())).toList(),
        fromCache: s.metadata.isFromCache,
        receivedAt: DateTime.now(),
      );
    } catch (e) {
      throw FirestoreRepository.mapError(e);
    }
  }

  /// Short-lived download URL of a private photo (never stored or logged).
  Future<String> downloadUrl(String path) async {
    try {
      return await FirebaseStorage.instance.ref(path).getDownloadURL();
    } catch (e) {
      throw FirestoreRepository.mapError(e);
    }
  }

  /// Uploads a bank receipt to
  /// `orgs/{org}/campuses/{campus}/parent/{uid}/proofs/{opId}.jpg` and returns the path.
  Future<String> uploadProof(File file, {required String uid, required String opId}) async {
    final path = 'orgs/$orgId/campuses/$campusId/parent/$uid/proofs/$opId.jpg';
    try {
      await FirebaseStorage.instance
          .ref(path)
          .putFile(file, SettableMetadata(contentType: 'image/jpeg'));
      return path;
    } on FirebaseException catch (e) {
      throw AppException(
        e.code == 'unauthorized' ? AppException.permissionDenied : AppException.network,
        '',
      );
    } catch (_) {
      throw const AppException(AppException.network, '');
    }
  }
}
