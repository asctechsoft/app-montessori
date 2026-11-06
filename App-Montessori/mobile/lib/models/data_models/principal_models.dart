import 'package:cloud_firestore/cloud_firestore.dart';

/// One Firestore document (id + data) with tolerant typed getters, used by the
/// principal screens that only display fields (no write-back).
class PDoc {
  const PDoc(this.id, this.data);

  final String id;
  final Map<String, dynamic> data;

  String str(String key, [String fallback = '']) {
    final v = data[key];
    return v == null ? fallback : v.toString();
  }

  int? intOf(String key) {
    final v = data[key];
    if (v is int) return v;
    if (v is num) return v.round();
    return int.tryParse(v?.toString() ?? '');
  }

  bool flag(String key) => data[key] == true;

  DateTime? dt(String key) => toDate(data[key]);

  Map<String, dynamic> map(String key) => asMap(data[key]);

  List<dynamic> list(String key) {
    final v = data[key];
    return v is List ? v : const [];
  }
}

DateTime? toDate(Object? v) {
  if (v is Timestamp) return v.toDate();
  if (v is DateTime) return v;
  if (v is String) return DateTime.tryParse(v);
  return null;
}

Map<String, dynamic> asMap(Object? v) {
  if (v is Map) return v.map((k, val) => MapEntry(k.toString(), val));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> asMapList(Object? v) =>
    v is List ? v.whereType<Map>().map(asMap).toList() : <Map<String, dynamic>>[];

int? asInt(Object? v) {
  if (v is int) return v;
  if (v is num) return v.round();
  return int.tryParse(v?.toString() ?? '');
}

/// `approvals/{id}` (CONTRACT §4 "Phê duyệt tập trung").
class ApprovalItem {
  ApprovalItem(this.doc);

  final PDoc doc;

  String get id => doc.id;
  String get type => doc.str('type');
  String get status => doc.str('status', 'pending');
  String get summary => doc.str('summary');
  String get requiredPerm => doc.str('requiredPerm');
  String? get campusId => doc.data['campusId']?.toString();
  String get requestedByName => doc.str('requestedByName');
  String get requestedBy => doc.str('requestedBy');
  DateTime? get createdAt => doc.dt('createdAt');
  Map<String, dynamic> get impact => doc.map('impact');
  Map<String, dynamic> get payload => doc.map('payload');
  String get refCollection => doc.str('refCollection');
  String get refId => doc.str('refId');
}

/// Types of approval the centre knows (CONTRACT §4).
const List<String> kApprovalTypes = [
  'attendance_correction',
  'punch_adjust',
  'staff_leave',
  'shift_swap',
  'overtime',
  'transfer',
  'enrollment_exception',
  'refund',
  'receivable_adjust',
  'payment_cancel',
  'expense',
  'billing_run',
  'payroll_run',
  'timesheet_reopen',
  'notification',
  'stock_variance',
  'menu',
];

/// `dashboard.campus` response (today's figures of one campus).
class CampusSnapshot {
  const CampusSnapshot(this.raw);

  final Map<String, dynamic> raw;

  int? get enrolled => asInt(raw['enrolled']);
  int? get presentToday => asInt(raw['presentToday']);
  int? get absentToday => asInt(raw['absentToday']);
  int? get stillAtSchool => asInt(raw['stillAtSchool']);
  int? get pendingApprovals => asInt(raw['pendingApprovals']);
  int? get openAlerts => asInt(raw['openAlerts']);
  int? get outstanding => asInt(raw['outstanding']);
  int? get overdueAmount => asInt(raw['overdueAmount']);
  int? get overdueCount => asInt(raw['overdueCount']);
  String get dayKey => (raw['dayKey'] ?? '').toString();
  List<Map<String, dynamic>> get alerts => asMapList(raw['alerts']);
}

/// `report.get` response.
class ReportData {
  const ReportData(this.raw);

  final Map<String, dynamic> raw;

  String get type => (raw['type'] ?? '').toString();
  Map<String, dynamic> get metrics => asMap(raw['metrics']);
  List<Map<String, dynamic>> get rows => asMapList(raw['rows']);
  Map<String, dynamic> get definitions => asMap(raw['definitions']);
  bool get truncated => raw['truncated'] == true;

  /// Metric as int (null when missing: never shown as 0).
  int? metric(String key) => asInt(metrics[key]);

  /// Percentage metric (may be fractional).
  double? pct(String key) {
    final v = metrics[key];
    if (v is num) return v.toDouble();
    return null;
  }
}

/// Everything the overview tab shows, cached as raw JSON for offline.
class OverviewBundle {
  const OverviewBundle({
    required this.snapshot,
    this.handover,
    this.attendance,
    this.hr,
    this.medicationPending,
    this.incidentsOpen,
    this.notPunched,
    this.shiftConflicts,
  });

  final CampusSnapshot snapshot;
  final ReportData? handover;
  final ReportData? attendance;
  final ReportData? hr;

  /// Firestore-derived counts (null = not allowed or not loaded).
  final int? medicationPending;
  final int? incidentsOpen;
  final int? notPunched;
  final int? shiftConflicts;

  Map<String, dynamic> toJson() => {
    'snapshot': snapshot.raw,
    'handover': handover?.raw,
    'attendance': attendance?.raw,
    'hr': hr?.raw,
  };

  static OverviewBundle? fromJson(Object? v) {
    if (v is! Map) return null;
    final m = asMap(v);
    final s = asMap(m['snapshot']);
    if (s.isEmpty) return null;
    ReportData? r(String k) {
      final x = asMap(m[k]);
      return x.isEmpty ? null : ReportData(x);
    }

    return OverviewBundle(
      snapshot: CampusSnapshot(s),
      handover: r('handover'),
      attendance: r('attendance'),
      hr: r('hr'),
    );
  }
}

/// Staff view for one day.
class StaffDay {
  const StaffDay({
    required this.dayKey,
    required this.employees,
    required this.entries,
    required this.punches,
    required this.leaves,
    required this.swaps,
    this.fromCache = false,
  });

  final String dayKey;
  final List<PDoc> employees;
  final List<PDoc> entries;
  final List<PDoc> punches;
  final List<PDoc> leaves;
  final List<PDoc> swaps;
  final bool fromCache;

  String employeeName(String id) {
    for (final e in employees) {
      if (e.id == id) return e.str('fullName', id);
    }
    return id;
  }

  /// Employee id that actually works an entry (swap target wins).
  static String workerOf(PDoc entry) {
    final actual = entry.str('actualEmployeeId');
    return actual.isNotEmpty ? actual : entry.str('employeeId');
  }

  List<PDoc> punchesOf(String employeeId) =>
      punches.where((p) => p.str('employeeId') == employeeId).toList();

  bool hasPunch(String employeeId, String kind) =>
      punchesOf(employeeId).any((p) => p.str('kind') == kind);

  /// Entries of today whose worker has no `in` punch.
  List<PDoc> get missingIn => entries
      .where((e) => e.str('status') != 'on_leave')
      .where((e) => !hasPunch(workerOf(e), 'in'))
      .toList();

  /// Workers with `in` but no `out`.
  List<String> get missingOut {
    final ids = <String>{};
    for (final e in entries) {
      final w = workerOf(e);
      if (hasPunch(w, 'in') && !hasPunch(w, 'out')) ids.add(w);
    }
    return ids.toList();
  }

  /// Employees scheduled on two entries of the same day with overlapping times.
  List<String> get overlapping {
    final byWorker = <String, List<PDoc>>{};
    for (final e in entries.where((e) => e.str('status') != 'on_leave')) {
      byWorker.putIfAbsent(workerOf(e), () => []).add(e);
    }
    final out = <String>[];
    byWorker.forEach((id, list) {
      if (list.length < 2) return;
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          final a = list[i].map('shiftSnapshot');
          final b = list[j].map('shiftSnapshot');
          final as = a['startTime']?.toString() ?? '';
          final ae = a['endTime']?.toString() ?? '';
          final bs = b['startTime']?.toString() ?? '';
          final be = b['endTime']?.toString() ?? '';
          if (as.isEmpty || bs.isEmpty) continue;
          if (as.compareTo(be) < 0 && bs.compareTo(ae) < 0) {
            if (!out.contains(id)) out.add(id);
          }
        }
      }
    });
    return out;
  }
}
