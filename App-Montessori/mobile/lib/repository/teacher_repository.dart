import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

import '../models/data_models/teacher_models.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import 'firestore_repository.dart';

/// Reads (Firestore, scoped to the active org/campus) and writes (callable
/// `api`) of the teacher / staff role. Reads are one-shot with `fromCache`
/// metadata so the UI can show "offline stale". Tests subclass and override.
class TeacherRepository extends FirestoreRepository {
  TeacherRepository({super.db, super.session});

  Future<Map<String, dynamic>> _call(
    String action,
    Map<String, dynamic> payload, {
    String? opId,
    bool campus = true,
  }) => ApiService.to.call(
    action,
    orgId: orgId,
    campusId: campus ? campusId : null,
    payload: payload,
    opId: opId,
  );

  String get uid => session.uid.value;

  // ------------------------------------------------------------------ classes

  /// Classes of the active campus the teacher may see: grant.classIds, else
  /// effective `assignments`. Managers (no teacher grant) see every class.
  Future<DataSnapshot<TeacherClass>> classes() async {
    final all = await getCollection<TeacherClass>(
      'classes',
      fromMap: TeacherClass.fromMap,
    );
    final allowed = await _allowedClassIds();
    if (allowed == null) return all;
    return DataSnapshot(
      all.items.where((c) => allowed.contains(c.id)).toList(),
      fromCache: all.fromCache,
      receivedAt: all.receivedAt,
    );
  }

  /// null = not limited by class.
  Future<Set<String>?> _allowedClassIds() async {
    final m = session.membership;
    if (m == null) return <String>{};
    final now = DateTime.now();
    final fromGrants = m.classIdsFor(campusId, now);
    if (fromGrants.isNotEmpty) return fromGrants.toSet();
    final onlyTeacher = m.grants.isNotEmpty &&
        m.grants.where((g) => g.isActiveAt(now)).every((g) => g.roleId == 'teacher');
    if (!onlyTeacher) return null;
    final a = await getCollection<Map<String, dynamic>>(
      'assignments',
      fromMap: (id, d) => d,
      build: (q) => q.where('uid', isEqualTo: uid),
    );
    final out = <String>{};
    for (final d in a.items) {
      if (d['status'] == 'cancelled' || d['archived'] == true) continue;
      final from = tsToDate(d['validFrom']);
      final to = tsToDate(d['validTo']);
      if (from != null && from.isAfter(now)) continue;
      if (to != null && to.isBefore(now)) continue;
      out.add(d['classId'].toString());
    }
    return out;
  }

  Future<DataSnapshot<TeacherChild>> children(String classId) async {
    final r = await getCollection<TeacherChild>(
      'children',
      fromMap: TeacherChild.fromMap,
      build: (q) => q.where('classId', isEqualTo: classId),
    );
    final items = r.items
        .where((c) => const ['active', 'trial', 'on_leave'].contains(c.status))
        .toList()
      ..sort((a, b) => a.fullName.compareTo(b.fullName));
    return DataSnapshot(items, fromCache: r.fromCache, receivedAt: r.receivedAt);
  }

  /// Health notes; null when not readable (no permission / no record).
  Future<ChildHealth?> health(String childId) async {
    try {
      final s = await db.doc('orgs/$orgId/children/$childId/private/health').get();
      if (!s.exists || s.data() == null) return null;
      return ChildHealth.fromMap(s.data()!);
    } catch (_) {
      return null;
    }
  }

  // --------------------------------------------------------- attendance/handover

  Future<DataSnapshot<AttendanceRec>> attendance(String classId, String dayKey) =>
      getCollection<AttendanceRec>(
        'attendance',
        fromMap: AttendanceRec.fromMap,
        build: (q) => q.where('classId', isEqualTo: classId).where('dayKey', isEqualTo: dayKey),
      );

  Future<DataSnapshot<HandoverRec>> handovers(String classId, String dayKey) =>
      getCollection<HandoverRec>(
        'handovers',
        fromMap: HandoverRec.fromMap,
        build: (q) => q.where('classId', isEqualTo: classId).where('dayKey', isEqualTo: dayKey),
      );

  Future<DataSnapshot<PickupAuth>> pickupAuths(String childId) =>
      getCollection<PickupAuth>(
        'pickupAuthorizations',
        fromMap: PickupAuth.fromMap,
        build: (q) => q.where('childId', isEqualTo: childId),
      );

  Future<DataSnapshot<LeaveReq>> leaves() => getCollection<LeaveReq>(
    'leaveRequests',
    fromMap: LeaveReq.fromMap,
    limit: 200,
  );

  Future<Map<String, dynamic>> markAttendance({
    required String classId,
    required String dayKey,
    required List<Map<String, dynamic>> items,
    required String opId,
  }) => _call('attendance.mark', {
    'classId': classId,
    'dayKey': dayKey,
    'session': 'all',
    'items': items,
  }, opId: opId);

  /// Payload of `handover.receive` (shared by the online call and the queue).
  Map<String, dynamic> receivePayload({
    required String childId,
    required String dayKey,
    required String droppedBy,
    required DateTime at,
  }) => {
    'childId': childId,
    'dayKey': dayKey,
    'droppedBy': droppedBy,
    'at': at.toUtc().toIso8601String(),
  };

  Future<Map<String, dynamic>> receive(Map<String, dynamic> payload, String opId) =>
      ApiService.to.call('handover.receive', orgId: orgId, payload: payload, opId: opId);

  Future<Map<String, dynamic>> pickup({
    required String childId,
    required String dayKey,
    required String pickupPersonId,
    required String method,
    String? note,
    required String opId,
  }) => ApiService.to.call(
    'handover.pickup',
    orgId: orgId,
    payload: {
      'childId': childId,
      'dayKey': dayKey,
      'pickupPersonId': pickupPersonId,
      'verification': {'method': method, 'note': ?note},
    },
    opId: opId,
  );

  Future<Map<String, dynamic>> decideLeave({
    required String id,
    required String decision,
    String? note,
    required String opId,
  }) => ApiService.to.call(
    'leave.decide',
    orgId: orgId,
    payload: {'id': id, 'decision': decision, 'note': ?note},
    opId: opId,
  );

  // --------------------------------------------------------------------- diary

  Future<DataSnapshot<DailyLog>> dailyLogs(String classId, String dayKey) =>
      getCollection<DailyLog>(
        'dailyLogs',
        fromMap: DailyLog.fromMap,
        build: (q) => q.where('classId', isEqualTo: classId).where('dayKey', isEqualTo: dayKey),
      );

  Future<Map<String, dynamic>> saveDailyLog(Map<String, dynamic> payload, String opId) =>
      ApiService.to.call('dailyLog.save', orgId: orgId, payload: payload, opId: opId);

  Future<Map<String, dynamic>> publishDailyLogs({
    required String classId,
    required String dayKey,
    required List<String> childIds,
    required String opId,
  }) => ApiService.to.call(
    'dailyLog.publish',
    orgId: orgId,
    payload: {'classId': classId, 'dayKey': dayKey, 'childIds': childIds},
    opId: opId,
  );

  /// Uploads a photo under `orgs/{org}/campuses/{campus}/dailyLogs/{day}/{child}/`
  /// and returns the STORAGE PATH (never a long-lived URL).
  Future<String> uploadDiaryPhoto({
    required String childId,
    required String dayKey,
    required File file,
  }) async {
    try {
      final name = '${DateTime.now().millisecondsSinceEpoch}.jpg';
      final path = 'orgs/$orgId/campuses/$campusId/dailyLogs/$dayKey/$childId/$name';
      await FirebaseStorage.instance.ref(path).putFile(file);
      return path;
    } catch (e) {
      if (e is FirebaseException && e.code == 'unauthorized') {
        throw const AppException(AppException.permissionDenied, '');
      }
      throw const AppException(AppException.network, '');
    }
  }

  // ------------------------------------------------------ medication/incidents

  Future<DataSnapshot<MedRequest>> medRequests() => getCollection<MedRequest>(
    'medicationRequests',
    fromMap: MedRequest.fromMap,
    limit: 200,
  );

  Future<DataSnapshot<MedAdmin>> medAdmins(String requestId) => getCollection<MedAdmin>(
    'medicationAdmins',
    fromMap: MedAdmin.fromMap,
    build: (q) => q.where('requestId', isEqualTo: requestId),
  );

  Future<Map<String, dynamic>> decideMedication({
    required String id,
    required String decision,
    String? reason,
    required String opId,
  }) => ApiService.to.call(
    'medication.decide',
    orgId: orgId,
    payload: {'id': id, 'decision': decision, 'reason': ?reason},
    opId: opId,
  );

  Future<Map<String, dynamic>> administer({
    required String requestId,
    required DateTime at,
    required String dose,
    required String result,
    String? note,
    required String opId,
  }) => ApiService.to.call(
    'medication.administer',
    orgId: orgId,
    payload: {
      'requestId': requestId,
      'at': at.toUtc().toIso8601String(),
      'dose': dose,
      'result': result,
      'note': ?note,
    },
    opId: opId,
  );

  /// Incidents the staff member may read. Managers (`children.write`) may list
  /// the whole campus; others only `restricted == false` docs or docs that list
  /// them in `viewerUids`, and a list query must prove one of those: so on
  /// permission-denied run both restricted queries and merge.
  Future<DataSnapshot<IncidentRec>> incidents() async {
    try {
      return await getCollection<IncidentRec>(
        'incidents',
        fromMap: IncidentRec.fromMap,
        limit: 100,
      );
    } on AppException catch (e) {
      if (e.code != AppException.permissionDenied) rethrow;
    }
    Future<DataSnapshot<IncidentRec>?> run(
      Query<Map<String, dynamic>> Function(Query<Map<String, dynamic>>) build,
    ) async {
      try {
        return await getCollection<IncidentRec>(
          'incidents',
          fromMap: IncidentRec.fromMap,
          build: build,
          limit: 100,
        );
      } on AppException catch (e) {
        if (e.code == AppException.permissionDenied) return null;
        rethrow;
      }
    }

    final r = (await Future.wait([
      run((q) => q.where('viewerUids', arrayContains: uid)),
      run((q) => q.where('restricted', isEqualTo: false)),
    ])).whereType<DataSnapshot<IncidentRec>>().toList();
    if (r.isEmpty) throw const AppException(AppException.permissionDenied, '');
    final byId = <String, IncidentRec>{
      for (final s in r) for (final i in s.items) i.id: i,
    };
    return DataSnapshot<IncidentRec>(
      byId.values.toList(),
      fromCache: r.any((s) => s.fromCache),
      receivedAt: DateTime.now(),
    );
  }

  Future<Map<String, dynamic>> saveIncident(Map<String, dynamic> payload, String opId) =>
      ApiService.to.call('incident.save', orgId: orgId, campusId: campusId, payload: payload, opId: opId);

  // ------------------------------------------------------------- staff / punches

  String? get employeeId => session.membership?.employeeId;

  Future<DataSnapshot<PunchRec>> punches(String fromDay, String toDay) async {
    final e = employeeId;
    if (e == null) {
      return DataSnapshot(const [], receivedAt: DateTime.now());
    }
    final r = await getCollection<PunchRec>(
      'punches',
      fromMap: PunchRec.fromMap,
      build: (q) => q
          .where('employeeId', isEqualTo: e)
          .where('dayKey', isGreaterThanOrEqualTo: fromDay)
          .where('dayKey', isLessThanOrEqualTo: toDay),
      campusScoped: false,
    );
    final items = r.items.toList()
      ..sort((a, b) => (a.time ?? DateTime(0)).compareTo(b.time ?? DateTime(0)));
    return DataSnapshot(items, fromCache: r.fromCache, receivedAt: r.receivedAt);
  }

  /// Shifts of the employee. Rules may not expose roster entries to staff yet
  /// (CONTRACT_CHANGES); a denied read returns an empty, non-fatal result.
  Future<DataSnapshot<RosterEntry>> roster(String fromDay, String toDay) async {
    final e = employeeId;
    if (e == null) return DataSnapshot(const [], receivedAt: DateTime.now());
    try {
      return await getCollection<RosterEntry>(
        'rosterEntries',
        fromMap: RosterEntry.fromMap,
        build: (q) => q
            .where('employeeId', isEqualTo: e)
            .where('dayKey', isGreaterThanOrEqualTo: fromDay)
            .where('dayKey', isLessThanOrEqualTo: toDay),
        campusScoped: false,
      );
    } on AppException catch (ex) {
      if (ex.isForbidden) return DataSnapshot(const [], receivedAt: DateTime.now());
      rethrow;
    }
  }

  Future<Map<String, dynamic>> punch({
    required Map<String, dynamic> payload,
    required String opId,
  }) => ApiService.to.call('punch.record', orgId: orgId, campusId: campusId, payload: payload, opId: opId);

  Future<DataSnapshot<PunchAdjust>> punchAdjustments() => _mine<PunchAdjust>('punchAdjustments', PunchAdjust.fromMap);

  Future<DataSnapshot<StaffLeaveRec>> staffLeaves() => _mine<StaffLeaveRec>('staffLeaves', StaffLeaveRec.fromMap);

  Future<DataSnapshot<ShiftSwapRec>> shiftSwaps() => _mine<ShiftSwapRec>('shiftSwaps', ShiftSwapRec.fromMap);

  Future<DataSnapshot<T>> _mine<T>(
    String name,
    T Function(String, Map<String, dynamic>) fromMap,
  ) async {
    final e = employeeId;
    if (e == null) return DataSnapshot(const [], receivedAt: DateTime.now());
    return getCollection<T>(
      name,
      fromMap: fromMap,
      build: (q) => q.where('employeeId', isEqualTo: e),
      campusScoped: false,
      limit: 100,
    );
  }

  /// Swaps proposed TO me (`toEmployeeId == me`).
  Future<DataSnapshot<ShiftSwapRec>> swapsForMe() async {
    final e = employeeId;
    if (e == null) return DataSnapshot(const [], receivedAt: DateTime.now());
    return getCollection<ShiftSwapRec>(
      'shiftSwaps',
      fromMap: ShiftSwapRec.fromMap,
      build: (q) => q.where('toEmployeeId', isEqualTo: e),
      campusScoped: false,
      limit: 50,
    );
  }

  Future<DataSnapshot<Payslip>> payslips() => getCollection<Payslip>(
    'payslips',
    fromMap: Payslip.fromMap,
    build: (q) => q.where('employeeUid', isEqualTo: uid),
    campusScoped: false,
    limit: 24,
  );

  Future<Map<String, dynamic>> request(String action, Map<String, dynamic> payload, String opId) =>
      ApiService.to.call(action, orgId: orgId, campusId: campusId, payload: payload, opId: opId);

  // --------------------------------------------------------------- inbox/threads

  Future<DataSnapshot<NotificationItem>> notifications() async {
    final receipts = await getCollection<Map<String, dynamic>>(
      'notificationReceipts',
      fromMap: (id, d) => {...d, '_id': id},
      build: (q) => q.where('uid', isEqualTo: uid),
      campusScoped: false,
      limit: 30,
    );
    final out = <NotificationItem>[];
    for (final r in receipts.items) {
      final nid = (r['notifId'] ?? r['notificationId'] ?? r['_id'].toString().split('_').first).toString();
      try {
        final s = await orgDoc('notifications', nid).get();
        final d = s.data();
        if (d == null) continue;
        out.add(NotificationItem(
          id: nid,
          title: (d['title'] ?? '').toString(),
          body: (d['body'] ?? '').toString(),
          category: (d['category'] ?? '').toString(),
          requireAck: r['requireAck'] == true,
          readAt: tsToDate(r['readAt']),
          ackAt: tsToDate(r['ackAt']),
          sentAt: tsToDate(d['sentAt'] ?? d['createdAt']),
        ));
      } catch (_) {
        continue;
      }
    }
    out.sort((a, b) => (b.sentAt ?? DateTime(0)).compareTo(a.sentAt ?? DateTime(0)));
    return DataSnapshot(out, fromCache: receipts.fromCache, receivedAt: receipts.receivedAt);
  }

  Future<void> markRead(String id) =>
      ApiService.to.call('notification.markRead', orgId: orgId, payload: {'id': id}).then((_) {});

  Future<void> ack(String id) =>
      ApiService.to.call('notification.ack', orgId: orgId, payload: {'id': id}).then((_) {});

  Future<DataSnapshot<ThreadItem>> threads() async {
    final r = await getCollection<ThreadItem>(
      'threads',
      fromMap: ThreadItem.fromMap,
      build: (q) => q.where('participants', arrayContains: uid),
      limit: 50,
    );
    final items = r.items.toList()
      ..sort((a, b) => (b.lastMessageAt ?? DateTime(0)).compareTo(a.lastMessageAt ?? DateTime(0)));
    return DataSnapshot(items, fromCache: r.fromCache, receivedAt: r.receivedAt);
  }

  Future<DataSnapshot<MessageItem>> messages(String threadId) async {
    try {
      final s = await orgCollection('threads/$threadId/messages').orderBy('at').limit(100).get();
      return DataSnapshot(
        s.docs.map((d) => MessageItem.fromMap(d.id, d.data())).toList(),
        fromCache: s.metadata.isFromCache,
        receivedAt: DateTime.now(),
      );
    } catch (e) {
      throw FirestoreRepository.mapError(e);
    }
  }

  Future<Map<String, dynamic>> postMessage(String threadId, String text, String opId) =>
      ApiService.to.call('thread.post', orgId: orgId, payload: {'threadId': threadId, 'text': text}, opId: opId);

  Future<Map<String, dynamic>> openThread(Map<String, dynamic> payload, String opId) =>
      ApiService.to.call('thread.open', orgId: orgId, payload: payload, opId: opId);
}
