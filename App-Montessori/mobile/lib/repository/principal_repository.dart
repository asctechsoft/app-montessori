import '../models/data_models/principal_models.dart';
import '../services/network/api_service.dart';
import 'firestore_repository.dart';

/// Reads (Firestore, campus scoped) and the few API reads/writes of the
/// principal tabs. Tests subclass it and override the methods.
class PrincipalRepository extends FirestoreRepository {
  // ignore: prefer_initializing_formals
  PrincipalRepository({super.db, super.session, ApiService? api}) : _api = api;

  final ApiService? _api;
  ApiService get api => _api ?? ApiService.to;

  PDoc _doc(String id, Map<String, dynamic> d) => PDoc(id, d);

  Future<DataSnapshot<PDoc>> _list(
    String name, {
    Map<String, Object?> where = const {},
    int? limit,
  }) => getCollection<PDoc>(
    name,
    fromMap: _doc,
    limit: limit,
    build: (q) {
      var x = q;
      where.forEach((k, v) => x = x.where(k, isEqualTo: v));
      return x;
    },
  );

  // ------------------------------------------------------------------ API

  Future<CampusSnapshot> dashboard() async {
    final id = campusId;
    final r = await api.call(
      'dashboard.campus',
      campusId: id,
      payload: {'campusId': id},
      idempotent: true,
    );
    return CampusSnapshot(r);
  }

  Future<ReportData> report(
    String type, {
    required String from,
    required String to,
    String? classId,
  }) async {
    final id = campusId;
    final r = await api.call(
      'report.get',
      campusId: id,
      payload: {
        'type': type,
        'campusId': id,
        'from': from,
        'to': to,
        'classId': ?classId,
      },
      idempotent: true,
    );
    return ReportData(r);
  }

  /// `approval.decide`; [opId] is created once per intent by the caller.
  Future<Map<String, dynamic>> decide({
    required String id,
    required String decision,
    required String note,
    required String opId,
    String? approvalCampusId,
  }) => api.call(
    'approval.decide',
    campusId: approvalCampusId ?? campusId,
    payload: {'id': id, 'decision': decision, 'note': note},
    opId: opId,
  );

  /// `approval.list` (máy chủ lọc theo approvals.read + requiredPerm tại cơ sở);
  /// KHÔNG đọc trực tiếp collection approvals (rules không cho truy vấn list).
  Future<DataSnapshot<PDoc>> pendingApprovals() async {
    final id = campusId;
    final r = await api.call(
      'approval.list',
      campusId: id,
      payload: {'campusId': id, 'status': 'pending', 'limit': 100},
      idempotent: true,
    );
    final items = (r['items'] is List ? r['items'] as List : const [])
        .whereType<Map>()
        .map((m) => PDoc(m['id']?.toString() ?? '', m.map((k, v) => MapEntry(k.toString(), v))))
        .toList();
    return DataSnapshot<PDoc>(items, receivedAt: DateTime.now());
  }

  // ------------------------------------------------------------ Firestore


  Future<DataSnapshot<PDoc>> classes() => _list('classes');
  Future<DataSnapshot<PDoc>> children() => _list('children');
  Future<DataSnapshot<PDoc>> handovers(String dayKey) =>
      _list('handovers', where: {'dayKey': dayKey});
  Future<DataSnapshot<PDoc>> attendance(String dayKey) =>
      _list('attendance', where: {'dayKey': dayKey});
  Future<DataSnapshot<PDoc>> attendanceClosures(String dayKey) =>
      _list('attendanceClosures', where: {'dayKey': dayKey});
  Future<DataSnapshot<PDoc>> dailyLogs(String dayKey) =>
      _list('dailyLogs', where: {'dayKey': dayKey});
  Future<DataSnapshot<PDoc>> medicationRequests() =>
      _list('medicationRequests', where: {'status': 'pending'});
  Future<DataSnapshot<PDoc>> incidents() =>
      _list('incidents', where: {'status': 'open'});
  Future<DataSnapshot<PDoc>> employees() => _list('employees');

  Future<StaffDay> staffDay(String dayKey, {required bool canTimekeeping, required bool canLeave}) async {
    final emps = await employees();
    final results = await Future.wait([
      canTimekeeping ? _list('rosterEntries', where: {'dayKey': dayKey}) : Future.value(_empty()),
      canTimekeeping ? _list('punches', where: {'dayKey': dayKey}) : Future.value(_empty()),
      canLeave ? _list('staffLeaves', where: {'status': 'pending'}) : Future.value(_empty()),
      canLeave ? _list('shiftSwaps', where: {'status': 'awaiting_manager'}) : Future.value(_empty()),
    ]);
    return StaffDay(
      dayKey: dayKey,
      employees: emps.items.where((e) => e.str('status', 'active') == 'active' && !e.flag('archived')).toList(),
      entries: results[0].items.where((e) => e.str('status') != 'superseded').toList(),
      punches: results[1].items,
      leaves: results[2].items,
      swaps: results[3].items,
      fromCache: emps.fromCache || results.any((r) => r.fromCache),
    );
  }

  DataSnapshot<PDoc> _empty() =>
      DataSnapshot<PDoc>(const [], receivedAt: DateTime.now());
}
