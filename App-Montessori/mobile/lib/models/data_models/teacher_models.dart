import 'package:cloud_firestore/cloud_firestore.dart';

/// Read models of the teacher / staff role (T01-T07). Parsing is tolerant: a
/// missing field never throws (CONTRACT §2: instants are `Timestamp`, days are
/// `dayKey` strings).

DateTime? tsToDate(Object? v) {
  if (v == null) return null;
  if (v is Timestamp) return v.toDate();
  if (v is DateTime) return v;
  if (v is String) return DateTime.tryParse(v);
  if (v is Map) {
    final s = v['_seconds'] ?? v['seconds'];
    if (s is num) return DateTime.fromMillisecondsSinceEpoch(s.toInt() * 1000);
  }
  return null;
}

String _s(Object? v) => v == null ? '' : v.toString();
String? _sn(Object? v) => (v == null || v.toString().isEmpty) ? null : v.toString();
List<String> _sl(Object? v) => v is List ? v.map((e) => e.toString()).toList() : <String>[];
Map<String, dynamic> _m(Object? v) =>
    v is Map ? v.map((k, val) => MapEntry(k.toString(), val)) : <String, dynamic>{};
List<Map<String, dynamic>> _ml(Object? v) =>
    v is List ? v.map(_m).toList() : <Map<String, dynamic>>[];
int _i(Object? v) => v is num ? v.toInt() : int.tryParse(_s(v)) ?? 0;
double _d(Object? v) => v is num ? v.toDouble() : double.tryParse(_s(v)) ?? 0;

class TeacherClass {
  const TeacherClass({required this.id, required this.name, this.code = '', this.room, this.capacity});

  final String id;
  final String name;
  final String code;
  final String? room;
  final int? capacity;

  factory TeacherClass.fromMap(String id, Map<String, dynamic> m) => TeacherClass(
    id: id,
    name: _s(m['name']),
    code: _s(m['code']),
    room: _sn(m['room']),
    capacity: m['capacity'] is num ? _i(m['capacity']) : null,
  );
}

/// Health notes a teacher may see (`children/{id}/private/health`).
class ChildHealth {
  const ChildHealth({this.allergies = const [], this.conditions = const [], this.dietNote, this.notes});

  final List<String> allergies;
  final List<String> conditions;
  final String? dietNote;
  final String? notes;

  bool get hasAlert => allergies.isNotEmpty || conditions.isNotEmpty;

  /// Short line for the list: only what the duty needs.
  String get headline => [...allergies, ...conditions].join(', ');

  factory ChildHealth.fromMap(Map<String, dynamic> m) => ChildHealth(
    allergies: _sl(m['allergies']),
    conditions: _sl(m['conditions']),
    dietNote: _sn(m['dietNote']),
    notes: _sn(m['notes']),
  );
}

class TeacherChild {
  TeacherChild({
    required this.id,
    required this.fullName,
    this.code = '',
    this.classId,
    this.status = 'active',
    this.photoConsent = false,
    this.health,
  });

  final String id;
  final String fullName;
  final String code;
  final String? classId;
  final String status;
  final bool photoConsent;
  ChildHealth? health;

  factory TeacherChild.fromMap(String id, Map<String, dynamic> m) => TeacherChild(
    id: id,
    fullName: _s(m['fullName']),
    code: _s(m['code']),
    classId: _sn(m['classId']),
    status: _s(m['status']).isEmpty ? 'active' : _s(m['status']),
    photoConsent: m['photoConsent'] == true,
  );
}

class AttendanceRec {
  const AttendanceRec({
    required this.id,
    required this.childId,
    required this.status,
    this.arrivedAt,
    this.droppedBy,
    this.note,
    this.healthNote,
    this.closed = false,
  });

  final String id;
  final String childId;
  final String status;
  final DateTime? arrivedAt;
  final String? droppedBy;
  final String? note;
  final String? healthNote;
  final bool closed;

  factory AttendanceRec.fromMap(String id, Map<String, dynamic> m) => AttendanceRec(
    id: id,
    childId: _s(m['childId']),
    status: _s(m['status']),
    arrivedAt: tsToDate(m['arrivedAt']),
    droppedBy: _sn(m['droppedBy']),
    note: _sn(m['note']),
    healthNote: _sn(m['healthNote']),
    closed: m['closed'] == true,
  );
}

class HandoverRec {
  const HandoverRec({
    required this.id,
    required this.childId,
    required this.state,
    this.receivedAt,
    this.droppedBy,
    this.receivedByName,
    this.pickedAt,
    this.pickupPersonName,
  });

  final String id;
  final String childId;

  /// `not_received | received | picked_up`
  final String state;
  final DateTime? receivedAt;
  final String? droppedBy;
  final String? receivedByName;
  final DateTime? pickedAt;
  final String? pickupPersonName;

  factory HandoverRec.fromMap(String id, Map<String, dynamic> m) => HandoverRec(
    id: id,
    childId: _s(m['childId']),
    state: _s(m['state']).isEmpty ? 'not_received' : _s(m['state']),
    receivedAt: tsToDate(m['receivedAt']),
    droppedBy: _sn(m['droppedBy']),
    receivedByName: _sn(m['receivedByName']),
    pickedAt: tsToDate(m['pickedAt']),
    pickupPersonName: _sn(m['pickupPersonName']),
  );
}

/// Why a pick-up person cannot take the child right now (mirrors the server
/// `details.reason` of `handover.pickup`).
class PickupBlock {
  const PickupBlock(this.reason);
  final String reason;
}

class PickupAuth {
  const PickupAuth({
    required this.id,
    required this.childId,
    required this.personName,
    this.relation = '',
    this.phone,
    this.idNumberLast4,
    this.status = 'approved',
    this.validFrom,
    this.validTo,
    this.validFromTime,
    this.validToTime,
  });

  final String id;
  final String childId;
  final String personName;
  final String relation;
  final String? phone;
  final String? idNumberLast4;

  /// `pending | approved | rejected | revoked`
  final String status;
  final String? validFrom;
  final String? validTo;
  final String? validFromTime;
  final String? validToTime;

  factory PickupAuth.fromMap(String id, Map<String, dynamic> m) => PickupAuth(
    id: id,
    childId: _s(m['childId']),
    personName: _s(m['personName']),
    relation: _s(m['relation']),
    phone: _sn(m['phone']),
    idNumberLast4: _sn(m['idNumberLast4']),
    status: _s(m['status']).isEmpty ? 'approved' : _s(m['status']),
    validFrom: _sn(m['validFrom']),
    validTo: _sn(m['validTo']),
    validFromTime: _sn(m['validFromTime']),
    validToTime: _sn(m['validToTime']),
  );

  /// Client-side mirror of the server check, used to explain and to disable
  /// the confirm button. The server remains the authority.
  PickupBlock? blockAt(String dayKey, String hhmm) {
    if (status == 'revoked') return const PickupBlock('authorization_revoked');
    if (status == 'pending') return const PickupBlock('authorization_pending');
    if (status != 'approved') return const PickupBlock('authorization_rejected');
    if (validFrom != null && validFrom!.compareTo(dayKey) > 0) {
      return const PickupBlock('authorization_not_started');
    }
    if (validTo != null && validTo!.compareTo(dayKey) < 0) {
      return const PickupBlock('authorization_expired');
    }
    if (validFromTime != null && validFrom == dayKey && hhmm.compareTo(validFromTime!) < 0) {
      return const PickupBlock('authorization_not_started');
    }
    if (validToTime != null && validTo == dayKey && hhmm.compareTo(validToTime!) > 0) {
      return const PickupBlock('authorization_expired');
    }
    return null;
  }

  /// `*** *** 6688` style: never show a full phone number.
  String? get maskedPhone {
    final p = phone;
    if (p == null || p.length < 4) return null;
    return '*** *** ${p.substring(p.length - 4)}';
  }
}

class LeaveReq {
  const LeaveReq({
    required this.id,
    required this.childId,
    this.classId,
    required this.fromDay,
    required this.toDay,
    this.session = 'all',
    this.reasonText,
    this.reasonId,
    this.note,
    this.status = 'pending',
    this.submittedAt,
    this.submittedByName,
    this.mealCancelledDays = const [],
    this.decisionNote,
  });

  final String id;
  final String childId;
  final String? classId;
  final String fromDay;
  final String toDay;
  final String session;
  final String? reasonText;
  final String? reasonId;
  final String? note;
  final String status;
  final DateTime? submittedAt;
  final String? submittedByName;
  final List<String> mealCancelledDays;
  final String? decisionNote;

  bool get isPending => status == 'pending';

  factory LeaveReq.fromMap(String id, Map<String, dynamic> m) => LeaveReq(
    id: id,
    childId: _s(m['childId']),
    classId: _sn(m['classId']),
    fromDay: _s(m['fromDay']),
    toDay: _s(m['toDay']),
    session: _s(m['session']).isEmpty ? 'all' : _s(m['session']),
    reasonText: _sn(m['reasonText']),
    reasonId: _sn(m['reasonId']),
    note: _sn(m['note']),
    status: _s(m['status']).isEmpty ? 'pending' : _s(m['status']),
    submittedAt: tsToDate(m['submittedAt']),
    submittedByName: _sn(m['submittedByName']),
    mealCancelledDays: _sl(m['mealCancelledDays']),
    decisionNote: _sn(m['decisionNote']),
  );
}

class DailyLog {
  const DailyLog({
    required this.id,
    required this.childId,
    required this.dayKey,
    this.status = 'draft',
    this.meals = const [],
    this.sleep = const [],
    this.hygiene = const {},
    this.mood,
    this.activities = const [],
    this.note,
    this.photoPaths = const [],
    this.version = 1,
  });

  final String id;
  final String childId;
  final String dayKey;

  /// `draft | published`
  final String status;
  final List<Map<String, dynamic>> meals;
  final List<Map<String, dynamic>> sleep;
  final Map<String, dynamic> hygiene;
  final String? mood;
  final List<String> activities;
  final String? note;
  final List<String> photoPaths;
  final int version;

  bool get isPublished => status == 'published';

  factory DailyLog.fromMap(String id, Map<String, dynamic> m) => DailyLog(
    id: id,
    childId: _s(m['childId']),
    dayKey: _s(m['dayKey']),
    status: _s(m['status']).isEmpty ? 'draft' : _s(m['status']),
    meals: _ml(m['meals']),
    sleep: _ml(m['sleep']),
    hygiene: _m(m['hygiene']),
    mood: _sn(m['mood']),
    activities: _sl(m['activities']),
    note: _sn(m['note']),
    photoPaths: _sl(m['photoPaths']),
    version: m['version'] is num ? _i(m['version']) : 1,
  );
}

class MedRequest {
  const MedRequest({
    required this.id,
    required this.childId,
    required this.medicineName,
    required this.dose,
    this.times = const [],
    this.fromDay = '',
    this.toDay = '',
    this.instructions = '',
    this.status = 'pending',
    this.storage,
    this.reason,
    this.requestedByName,
    this.version = 1,
  });

  final String id;
  final String childId;
  final String medicineName;
  final String dose;
  final List<String> times;
  final String fromDay;
  final String toDay;
  final String instructions;

  /// `pending | received | rejected | paused`
  final String status;
  final String? storage;
  final String? reason;
  final String? requestedByName;
  final int version;

  /// The request lacks what is needed to give the medicine: do not guess.
  bool get incomplete => medicineName.isEmpty || dose.isEmpty || times.isEmpty || instructions.isEmpty;

  factory MedRequest.fromMap(String id, Map<String, dynamic> m) => MedRequest(
    id: id,
    childId: _s(m['childId']),
    medicineName: _s(m['medicineName']),
    dose: _s(m['dose']),
    times: _sl(m['times']),
    fromDay: _s(m['fromDay']),
    toDay: _s(m['toDay']),
    instructions: _s(m['instructions']),
    status: _s(m['status']).isEmpty ? 'pending' : _s(m['status']),
    storage: _sn(m['storage']),
    reason: _sn(m['reason']),
    requestedByName: _sn(m['requestedByName']),
    version: m['version'] is num ? _i(m['version']) : 1,
  );
}

class MedAdmin {
  const MedAdmin({
    required this.id,
    required this.requestId,
    this.at,
    this.dose = '',
    this.result = '',
    this.note,
    this.administeredByName,
  });

  final String id;
  final String requestId;
  final DateTime? at;
  final String dose;
  final String result;
  final String? note;
  final String? administeredByName;

  factory MedAdmin.fromMap(String id, Map<String, dynamic> m) => MedAdmin(
    id: id,
    requestId: _s(m['requestId']),
    at: tsToDate(m['at']),
    dose: _s(m['dose']),
    result: _s(m['result']),
    note: _sn(m['note']),
    administeredByName: _sn(m['administeredByName']),
  );
}

class IncidentRec {
  const IncidentRec({
    required this.id,
    this.childId,
    this.type = '',
    this.severity = 'minor',
    this.description = '',
    this.status = 'open',
    this.occurredAt,
    this.location,
    this.firstAid,
  });

  final String id;
  final String? childId;
  final String type;
  final String severity;
  final String description;
  final String status;
  final DateTime? occurredAt;
  final String? location;
  final String? firstAid;

  factory IncidentRec.fromMap(String id, Map<String, dynamic> m) => IncidentRec(
    id: id,
    childId: _sn(m['childId']),
    type: _s(m['type']),
    severity: _s(m['severity']).isEmpty ? 'minor' : _s(m['severity']),
    description: _s(m['description']),
    status: _s(m['status']).isEmpty ? 'open' : _s(m['status']),
    occurredAt: tsToDate(m['occurredAt']),
    location: _sn(m['location']),
    firstAid: _sn(m['firstAid']),
  );
}

/// An ORIGINAL punch (never an adjustment).
class PunchRec {
  const PunchRec({
    required this.id,
    required this.kind,
    this.effectiveTime,
    this.deviceTime,
    this.dayKey = '',
    this.result = 'ok',
    this.source = 'app',
    this.pending = false,
  });

  final String id;

  /// `in | out`
  final String kind;
  final DateTime? effectiveTime;
  final DateTime? deviceTime;
  final String dayKey;

  /// `ok | outside_radius | no_location`
  final String result;
  final String source;

  /// True for an entry that exists only in the offline queue.
  final bool pending;

  DateTime? get time => effectiveTime ?? deviceTime;

  factory PunchRec.fromMap(String id, Map<String, dynamic> m) => PunchRec(
    id: id,
    kind: _s(m['kind']),
    effectiveTime: tsToDate(m['effectiveTime']),
    deviceTime: tsToDate(m['deviceTime']),
    dayKey: _s(m['dayKey']),
    result: _s(m['result']).isEmpty ? 'ok' : _s(m['result']),
    source: _s(m['source']).isEmpty ? 'app' : _s(m['source']),
  );
}

class RosterEntry {
  const RosterEntry({
    required this.id,
    required this.dayKey,
    this.shiftName = '',
    this.start = '',
    this.end = '',
    this.campusId = '',
    this.status = 'published',
    this.employeeId = '',
    this.actualEmployeeId,
  });

  final String id;
  final String dayKey;
  final String shiftName;
  final String start;
  final String end;
  final String campusId;
  final String status;
  final String employeeId;
  final String? actualEmployeeId;

  factory RosterEntry.fromMap(String id, Map<String, dynamic> m) {
    final snap = _m(m['shiftSnapshot']);
    return RosterEntry(
      id: id,
      dayKey: _s(m['dayKey']),
      shiftName: _s(snap['name']).isEmpty ? _s(snap['code']) : _s(snap['name']),
      start: _s(snap['startTime']),
      end: _s(snap['endTime']),
      campusId: _s(m['campusId']),
      status: _s(m['status']),
      employeeId: _s(m['employeeId']),
      actualEmployeeId: _sn(m['actualEmployeeId']),
    );
  }
}

class PunchAdjust {
  const PunchAdjust({
    required this.id,
    required this.dayKey,
    required this.kind,
    this.requestedTime,
    this.reason = '',
    this.status = 'pending',
  });

  final String id;
  final String dayKey;
  final String kind;
  final DateTime? requestedTime;
  final String reason;
  final String status;

  factory PunchAdjust.fromMap(String id, Map<String, dynamic> m) => PunchAdjust(
    id: id,
    dayKey: _s(m['dayKey']),
    kind: _s(m['kind']),
    requestedTime: tsToDate(m['requestedTime']),
    reason: _s(m['reason']),
    status: _s(m['status']).isEmpty ? 'pending' : _s(m['status']),
  );
}

class StaffLeaveRec {
  const StaffLeaveRec({
    required this.id,
    required this.type,
    required this.fromDay,
    required this.toDay,
    this.reason = '',
    this.status = 'pending',
    this.days,
  });

  final String id;
  final String type;
  final String fromDay;
  final String toDay;
  final String reason;
  final String status;
  final double? days;

  factory StaffLeaveRec.fromMap(String id, Map<String, dynamic> m) => StaffLeaveRec(
    id: id,
    type: _s(m['type']),
    fromDay: _s(m['fromDay']),
    toDay: _s(m['toDay']),
    reason: _s(m['reason']),
    status: _s(m['status']).isEmpty ? 'pending' : _s(m['status']),
    days: m['days'] is num ? _d(m['days']) : null,
  );
}

class ShiftSwapRec {
  const ShiftSwapRec({
    required this.id,
    required this.entryId,
    required this.dayKey,
    required this.fromEmployeeId,
    required this.toEmployeeId,
    this.fromName = '',
    this.toName = '',
    this.status = 'awaiting_peer',
    this.reason = '',
  });

  final String id;
  final String entryId;
  final String dayKey;
  final String fromEmployeeId;
  final String toEmployeeId;
  final String fromName;
  final String toName;

  /// `awaiting_peer | awaiting_manager | approved | rejected | declined_by_peer`
  final String status;
  final String reason;

  factory ShiftSwapRec.fromMap(String id, Map<String, dynamic> m) => ShiftSwapRec(
    id: id,
    entryId: _s(m['entryId']),
    dayKey: _s(m['dayKey']),
    fromEmployeeId: _s(m['fromEmployeeId']),
    toEmployeeId: _s(m['toEmployeeId']),
    fromName: _s(m['fromName']),
    toName: _s(m['toName']),
    status: _s(m['status']).isEmpty ? 'awaiting_peer' : _s(m['status']),
    reason: _s(m['reason']),
  );
}

class Payslip {
  const Payslip({
    required this.id,
    required this.periodKey,
    this.paidDays,
    this.standardDays,
    this.basePay = 0,
    this.overtimePay = 0,
    this.gross = 0,
    this.net = 0,
    this.allowances = 0,
    this.deductions = 0,
    this.paymentStatus = 'unpaid',
    this.publishedAt,
  });

  final String id;
  final String periodKey;
  final double? paidDays;
  final double? standardDays;
  final int basePay;
  final int overtimePay;
  final int gross;
  final int net;
  final int allowances;
  final int deductions;
  final String paymentStatus;
  final DateTime? publishedAt;

  static int _sum(Object? v) {
    if (v is num) return v.toInt();
    if (v is List) {
      return v.fold<int>(0, (n, e) => n + (e is Map ? _i(e['amount']) : _i(e)));
    }
    return 0;
  }

  factory Payslip.fromMap(String id, Map<String, dynamic> m) => Payslip(
    id: id,
    periodKey: _s(m['periodKey']),
    paidDays: m['paidDays'] is num ? _d(m['paidDays']) : null,
    standardDays: m['standardDays'] is num ? _d(m['standardDays']) : null,
    basePay: _i(m['basePay']),
    overtimePay: _i(m['overtimePay']),
    gross: _i(m['gross']),
    net: _i(m['net']),
    allowances: _sum(m['allowances']),
    deductions: _sum(m['deductions']),
    paymentStatus: _s(m['paymentStatus']).isEmpty ? 'unpaid' : _s(m['paymentStatus']),
    publishedAt: tsToDate(m['publishedAt']),
  );
}

class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.title,
    this.body = '',
    this.category = '',
    this.requireAck = false,
    this.readAt,
    this.ackAt,
    this.sentAt,
  });

  final String id;
  final String title;
  final String body;
  final String category;
  final bool requireAck;
  final DateTime? readAt;
  final DateTime? ackAt;
  final DateTime? sentAt;

  bool get unread => readAt == null;

  NotificationItem withReceipt({DateTime? readAt, DateTime? ackAt}) => NotificationItem(
    id: id,
    title: title,
    body: body,
    category: category,
    requireAck: requireAck,
    readAt: readAt ?? this.readAt,
    ackAt: ackAt ?? this.ackAt,
    sentAt: sentAt,
  );
}

class ThreadItem {
  const ThreadItem({
    required this.id,
    required this.subject,
    this.status = 'open',
    this.priority = 'normal',
    this.lastMessageAt,
    this.childId,
  });

  final String id;
  final String subject;
  final String status;
  final String priority;
  final DateTime? lastMessageAt;
  final String? childId;

  factory ThreadItem.fromMap(String id, Map<String, dynamic> m) => ThreadItem(
    id: id,
    subject: _s(m['subject']),
    status: _s(m['status']).isEmpty ? 'open' : _s(m['status']),
    priority: _s(m['priority']).isEmpty ? 'normal' : _s(m['priority']),
    lastMessageAt: tsToDate(m['lastMessageAt']),
    childId: _sn(m['childId']),
  );
}

class MessageItem {
  const MessageItem({
    required this.id,
    this.senderUid = '',
    this.senderName = '',
    this.text = '',
    this.at,
  });

  final String id;
  final String senderUid;
  final String senderName;
  final String text;
  final DateTime? at;

  factory MessageItem.fromMap(String id, Map<String, dynamic> m) => MessageItem(
    id: id,
    senderUid: _s(m['senderUid']),
    senderName: _s(m['senderName']),
    text: _s(m['text']),
    at: tsToDate(m['at']),
  );
}
