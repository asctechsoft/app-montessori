// Read models of the parent role (P01-P07). They are parsed tolerantly from
// Firestore maps: a missing field becomes null/empty, never a made-up value.

/// Firestore `Timestamp`, `DateTime` or ISO string -> `DateTime` (or null).
DateTime? parentDate(Object? v) {
  if (v == null) return null;
  if (v is DateTime) return v;
  if (v is String) return DateTime.tryParse(v);
  try {
    final d = (v as dynamic).toDate();
    if (d is DateTime) return d;
  } catch (_) {}
  return null;
}

String _s(Object? v) => v == null ? '' : v.toString().trim();
String? _sn(Object? v) {
  final t = _s(v);
  return t.isEmpty ? null : t;
}

int? _i(Object? v) {
  if (v is int) return v;
  if (v is num) return v.round();
  return int.tryParse(_s(v));
}

double? _d(Object? v) {
  if (v is num) return v.toDouble();
  return double.tryParse(_s(v));
}

List<String> _strs(Object? v) =>
    v is List ? v.map(_s).where((e) => e.isNotEmpty).toList() : <String>[];

List<Map<String, dynamic>> _maps(Object? v) => v is List
    ? v
          .whereType<Map>()
          .map((m) => m.map((k, val) => MapEntry(k.toString(), val)))
          .toList()
    : <Map<String, dynamic>>[];

Map<String, dynamic> _map(Object? v) =>
    v is Map ? v.map((k, val) => MapEntry(k.toString(), val)) : <String, dynamic>{};

/// `handovers/{childId}_{dayKey}`: received / picked up today.
class HandoverInfo {
  const HandoverInfo({
    required this.state,
    this.receivedAt,
    this.receivedByName,
    this.pickedAt,
    this.pickupPersonName,
  });

  /// `received` | `picked_up` | `not_received`.
  final String state;
  final DateTime? receivedAt;
  final String? receivedByName;
  final DateTime? pickedAt;
  final String? pickupPersonName;

  factory HandoverInfo.fromMap(String id, Map<String, dynamic> m) => HandoverInfo(
    state: _s(m['state']),
    receivedAt: parentDate(m['receivedAt']),
    receivedByName: _sn(m['receivedByName']),
    pickedAt: parentDate(m['pickedAt']),
    pickupPersonName: _sn(m['pickupPersonName']),
  );
}

/// `attendance/{childId}_{dayKey}_{session}`.
class AttendanceInfo {
  const AttendanceInfo({required this.status, this.arrivedAt});

  final String status;
  final DateTime? arrivedAt;

  factory AttendanceInfo.fromMap(String id, Map<String, dynamic> m) =>
      AttendanceInfo(status: _s(m['status']), arrivedAt: parentDate(m['arrivedAt']));
}

/// A PUBLISHED `dailyLogs` document (parents never read drafts).
///
/// The free-form parts (`meals`, `sleep`, `hygiene`) are written by teachers;
/// the app shows only the fields it recognises and never invents values.
class DailyLog {
  const DailyLog({
    required this.id,
    required this.dayKey,
    this.meals = const [],
    this.sleep = const [],
    this.hygiene = const {},
    this.mood,
    this.activities = const [],
    this.note,
    this.photoPaths = const [],
  });

  final String id;
  final String dayKey;
  final List<Map<String, dynamic>> meals;
  final List<Map<String, dynamic>> sleep;
  final Map<String, dynamic> hygiene;
  final String? mood;
  final List<String> activities;
  final String? note;
  final List<String> photoPaths;

  bool get isEmpty =>
      meals.isEmpty &&
      sleep.isEmpty &&
      hygiene.isEmpty &&
      mood == null &&
      activities.isEmpty &&
      note == null &&
      photoPaths.isEmpty;

  factory DailyLog.fromMap(String id, Map<String, dynamic> m) => DailyLog(
    id: id,
    dayKey: _s(m['dayKey']),
    meals: _maps(m['meals']),
    sleep: _maps(m['sleep']),
    hygiene: _map(m['hygiene']),
    mood: _sn(m['mood']),
    activities: _strs(m['activities']),
    note: _sn(m['note']),
    photoPaths: _strs(m['photoPaths']),
  );
}

/// `leaveRequests/{id}`.
class LeaveRequest {
  const LeaveRequest({
    required this.id,
    required this.childId,
    required this.fromDay,
    required this.toDay,
    required this.session,
    required this.status,
    this.reasonId,
    this.reasonText,
    this.note,
    this.submittedAt,
    this.decisionNote,
    this.mealCancelled,
  });

  final String id;
  final String childId;
  final String fromDay;
  final String toDay;
  final String session;
  final String status;
  final String? reasonId;
  final String? reasonText;
  final String? note;
  final DateTime? submittedAt;
  final String? decisionNote;
  final bool? mealCancelled;

  bool get isPending => status == 'pending';

  factory LeaveRequest.fromMap(String id, Map<String, dynamic> m) => LeaveRequest(
    id: id,
    childId: _s(m['childId']),
    fromDay: _s(m['fromDay']),
    toDay: _s(m['toDay']),
    session: _s(m['session']).isEmpty ? 'all' : _s(m['session']),
    status: _s(m['status']),
    reasonId: _sn(m['reasonId']),
    reasonText: _sn(m['reasonText']),
    note: _sn(m['note']),
    submittedAt: parentDate(m['submittedAt']),
    decisionNote: _sn(m['decisionNote']),
    mealCancelled: m['mealCancelled'] is bool ? m['mealCancelled'] as bool : null,
  );
}

/// `pickupAuthorizations/{id}`.
class PickupAuth {
  const PickupAuth({
    required this.id,
    required this.childId,
    required this.personName,
    required this.status,
    required this.type,
    this.relation,
    this.phone,
    this.idNumberLast4,
    this.validFrom,
    this.validTo,
    this.validFromTime,
    this.validToTime,
    this.note,
    this.decisionNote,
  });

  final String id;
  final String childId;
  final String personName;

  /// `pending` | `approved` | `rejected` | `revoked`.
  final String status;

  /// `guardian` (linked guardian) | `delegate` (temporary authorisation).
  final String type;
  final String? relation;
  final String? phone;
  final String? idNumberLast4;
  final String? validFrom;
  final String? validTo;
  final String? validFromTime;
  final String? validToTime;
  final String? note;
  final String? decisionNote;

  bool get isGuardian => type == 'guardian';

  /// Display status given today's `dayKey`: an approved authorisation past its
  /// end date is `expired`, one that has not started yet is `scheduled`.
  String effectiveStatus(String todayKey) {
    if (status != 'approved') return status;
    if (validTo != null && validTo!.compareTo(todayKey) < 0) return 'expired';
    if (validFrom != null && validFrom!.compareTo(todayKey) > 0) return 'scheduled';
    return 'approved';
  }

  factory PickupAuth.fromMap(String id, Map<String, dynamic> m) => PickupAuth(
    id: id,
    childId: _s(m['childId']),
    personName: _s(m['personName']),
    status: _s(m['status']),
    type: _s(m['type']).isEmpty ? 'delegate' : _s(m['type']),
    relation: _sn(m['relation']),
    phone: _sn(m['phone']),
    idNumberLast4: _sn(m['idNumberLast4']),
    validFrom: _sn(m['validFrom']),
    validTo: _sn(m['validTo']),
    validFromTime: _sn(m['validFromTime']),
    validToTime: _sn(m['validToTime']),
    note: _sn(m['note']),
    decisionNote: _sn(m['decisionNote']),
  );
}

/// `medicationRequests/{id}`.
class MedicationRequest {
  const MedicationRequest({
    required this.id,
    required this.medicineName,
    required this.dose,
    required this.status,
    this.times = const [],
    this.fromDay,
    this.toDay,
    this.instructions,
    this.reason,
  });

  final String id;
  final String medicineName;
  final String dose;

  /// `pending` | `received` | `rejected` | `paused`.
  final String status;
  final List<String> times;
  final String? fromDay;
  final String? toDay;
  final String? instructions;
  final String? reason;

  factory MedicationRequest.fromMap(String id, Map<String, dynamic> m) =>
      MedicationRequest(
        id: id,
        medicineName: _s(m['medicineName']),
        dose: _s(m['dose']),
        status: _s(m['status']),
        times: _strs(m['times']),
        fromDay: _sn(m['fromDay']),
        toDay: _sn(m['toDay']),
        instructions: _sn(m['instructions']),
        reason: _sn(m['reason'] ?? m['decisionReason']),
      );
}

/// `healthRecords/{id}`: one growth measurement.
class HealthRecord {
  const HealthRecord({
    required this.id,
    required this.measuredOn,
    this.heightCm,
    this.weightKg,
    this.bmi,
    this.note,
  });

  final String id;
  final String measuredOn;
  final double? heightCm;
  final double? weightKg;
  final double? bmi;
  final String? note;

  factory HealthRecord.fromMap(String id, Map<String, dynamic> m) => HealthRecord(
    id: id,
    measuredOn: _s(m['measuredOn']),
    heightCm: _d(m['heightCm']),
    weightKg: _d(m['weightKg']),
    bmi: _d(m['bmi']),
    note: _sn(m['note']),
  );
}

/// `children/{id}/private/health` (allergies, conditions...).
class ChildHealth {
  const ChildHealth({
    this.allergies = const [],
    this.conditions = const [],
    this.dietNote,
    this.bloodType,
    this.doctor,
    this.hospital,
    this.emergencyContact,
    this.notes,
  });

  final List<String> allergies;
  final List<String> conditions;
  final String? dietNote;
  final String? bloodType;
  final String? doctor;
  final String? hospital;
  final String? emergencyContact;
  final String? notes;

  bool get isEmpty =>
      allergies.isEmpty &&
      conditions.isEmpty &&
      dietNote == null &&
      bloodType == null &&
      doctor == null &&
      hospital == null &&
      emergencyContact == null &&
      notes == null;

  factory ChildHealth.fromMap(Map<String, dynamic> m) => ChildHealth(
    allergies: _strs(m['allergies']),
    conditions: _strs(m['conditions']),
    dietNote: _sn(m['dietNote']),
    bloodType: _sn(m['bloodType']),
    doctor: _sn(m['doctor']),
    hospital: _sn(m['hospital']),
    emergencyContact: _sn(m['emergencyContact']),
    notes: _sn(m['notes']),
  );
}

/// `children/{id}` fields the parent may see.
class ChildProfile {
  const ChildProfile({
    required this.id,
    required this.fullName,
    this.code,
    this.dob,
    this.gender,
    this.nickname,
    this.address,
    this.photoConsent,
  });

  final String id;
  final String fullName;
  final String? code;
  final String? dob;
  final String? gender;
  final String? nickname;
  final String? address;
  final bool? photoConsent;

  factory ChildProfile.fromMap(String id, Map<String, dynamic> m) => ChildProfile(
    id: id,
    fullName: _s(m['fullName']),
    code: _sn(m['code']),
    dob: _sn(m['dob']),
    gender: _sn(m['gender']),
    nickname: _sn(m['nickname']),
    address: _sn(m['address']),
    photoConsent: m['photoConsent'] is bool ? m['photoConsent'] as bool : null,
  );
}

class ReceivableLine {
  const ReceivableLine({
    required this.description,
    required this.amount,
    this.qty,
    this.unitPrice,
  });

  final String description;

  /// Signed VND: discounts are negative.
  final int amount;
  final int? qty;
  final int? unitPrice;

  factory ReceivableLine.fromMap(Map<String, dynamic> m) => ReceivableLine(
    description: _s(m['description'] ?? m['name']),
    amount: _i(m['amount']) ?? 0,
    qty: _i(m['qty']),
    unitPrice: _i(m['unitPrice']),
  );
}

/// `receivables/{id}`: what the family owes for one period.
class Receivable {
  const Receivable({
    required this.id,
    required this.periodKey,
    required this.status,
    required this.balance,
    this.amount = 0,
    this.allocated = 0,
    this.dueDate,
    this.lines = const [],
    this.pendingReconciliation = false,
  });

  final String id;

  /// `YYYY-MM`.
  final String periodKey;

  /// `unpaid` | `partially_paid` | `overdue` | `paid` | `cancelled` | `draft`.
  final String status;

  /// Still to pay (VND).
  final int balance;
  final int amount;
  final int allocated;

  /// `YYYY-MM-DD`.
  final String? dueDate;
  final List<ReceivableLine> lines;
  final bool pendingReconciliation;

  bool get isOpen =>
      status == 'unpaid' || status == 'partially_paid' || status == 'overdue';

  /// Parents never see drafts or cancelled receivables.
  bool get isVisible => status != 'draft' && status != 'cancelled';

  factory Receivable.fromMap(String id, Map<String, dynamic> m) => Receivable(
    id: id,
    periodKey: _s(m['periodKey']),
    status: _s(m['status']),
    balance: _i(m['balance']) ?? 0,
    amount: _i(m['amount']) ?? 0,
    allocated: _i(m['allocated']) ?? 0,
    dueDate: _sn(m['dueDate']),
    lines: _maps(m['lines']).map(ReceivableLine.fromMap).toList(),
    pendingReconciliation: m['pendingReconciliation'] == true,
  );
}

/// `payments/{id}` as the parent sees it (a submitted proof or a recorded payment).
class PaymentRecord {
  const PaymentRecord({
    required this.id,
    required this.type,
    required this.status,
    required this.amount,
    this.submittedAt,
    this.note,
  });

  final String id;

  /// `proof` = bank receipt sent by the parent, awaiting reconciliation.
  final String type;
  final String status;
  final int amount;
  final DateTime? submittedAt;
  final String? note;

  bool get isPendingProof => type == 'proof' && status == 'pending_reconciliation';

  factory PaymentRecord.fromMap(String id, Map<String, dynamic> m) => PaymentRecord(
    id: id,
    type: _s(m['type']),
    status: _s(m['status']),
    amount: _i(m['amount']) ?? 0,
    submittedAt: parentDate(m['submittedAt'] ?? m['createdAt'] ?? m['at']),
    note: _sn(m['note']),
  );
}

/// School bank account to transfer to (optional field of the campus document).
class BankInfo {
  const BankInfo({this.bankName, this.accountNo, this.accountName});

  final String? bankName;
  final String? accountNo;
  final String? accountName;

  bool get isEmpty => accountNo == null;

  factory BankInfo.fromCampus(Map<String, dynamic> m) {
    final b = _map(m['bankAccount'] ?? m['bank']);
    return BankInfo(
      bankName: _sn(b['bankName'] ?? b['bank']),
      accountNo: _sn(b['accountNo'] ?? b['accountNumber']),
      accountName: _sn(b['accountName'] ?? b['holder']),
    );
  }
}

/// `notificationReceipts/{notifId}_{uid}`: one notification for this user.
class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.title,
    this.category,
    this.sentAt,
    this.readAt,
    this.ackAt,
    this.requireAck = false,
    this.campusId,
  });

  final String id;
  final String title;
  final String? category;
  final DateTime? sentAt;
  final DateTime? readAt;
  final DateTime? ackAt;
  final bool requireAck;
  final String? campusId;

  bool get isRead => readAt != null;
  bool get needsAck => requireAck && ackAt == null;

  NotificationItem copyWith({DateTime? readAt, DateTime? ackAt}) => NotificationItem(
    id: id,
    title: title,
    category: category,
    sentAt: sentAt,
    readAt: readAt ?? this.readAt,
    ackAt: ackAt ?? this.ackAt,
    requireAck: requireAck,
    campusId: campusId,
  );

  factory NotificationItem.fromReceipt(String id, Map<String, dynamic> m) =>
      NotificationItem(
        id: _s(m['notifId']).isNotEmpty ? _s(m['notifId']) : (_s(m['notificationId']).isNotEmpty ? _s(m['notificationId']) : id),
        title: _s(m['title']),
        category: _sn(m['category']),
        sentAt: parentDate(m['sentAt'] ?? m['deliveredAt'] ?? m['createdAt']),
        readAt: parentDate(m['readAt']),
        ackAt: parentDate(m['ackAt']),
        requireAck: m['requireAck'] == true,
        campusId: _sn(m['campusId']),
      );
}

/// `threads/{id}`: conversation with the school.
class ThreadInfo {
  const ThreadInfo({
    required this.id,
    required this.subject,
    required this.status,
    this.childId,
    this.lastMessageAt,
    this.messageCount = 0,
  });

  final String id;
  final String subject;

  /// `open` | `closed`.
  final String status;
  final String? childId;
  final DateTime? lastMessageAt;
  final int messageCount;

  bool get isClosed => status == 'closed';

  factory ThreadInfo.fromMap(String id, Map<String, dynamic> m) => ThreadInfo(
    id: id,
    subject: _s(m['subject']),
    status: _s(m['status']),
    childId: _sn(m['childId']),
    lastMessageAt: parentDate(m['lastMessageAt']),
    messageCount: _i(m['messageCount']) ?? 0,
  );
}

class ThreadMessage {
  const ThreadMessage({
    required this.id,
    required this.text,
    required this.senderUid,
    required this.senderName,
    this.at,
  });

  final String id;
  final String text;
  final String senderUid;
  final String senderName;
  final DateTime? at;

  factory ThreadMessage.fromMap(String id, Map<String, dynamic> m) => ThreadMessage(
    id: id,
    text: _s(m['text']),
    senderUid: _s(m['senderUid']),
    senderName: _s(m['senderName']),
    at: parentDate(m['at'] ?? m['createdAt']),
  );
}

/// `menus/{id}` PUBLISHED menu of one day.
class MenuDay {
  const MenuDay({required this.dayKey, required this.meals});

  final String dayKey;

  /// `[{session, dishes:[{name, allergens[]}]}]`.
  final List<MenuMeal> meals;

  factory MenuDay.fromMap(String id, Map<String, dynamic> m) => MenuDay(
    dayKey: _s(m['dayKey']),
    meals: _maps(m['meals']).map(MenuMeal.fromMap).toList(),
  );
}

class MenuMeal {
  const MenuMeal({required this.session, required this.dishes});

  final String session;
  final List<MenuDish> dishes;

  factory MenuMeal.fromMap(Map<String, dynamic> m) => MenuMeal(
    session: _s(m['session']),
    dishes: _maps(m['dishes']).map(MenuDish.fromMap).toList(),
  );
}

class MenuDish {
  const MenuDish({required this.name, this.allergens = const []});

  final String name;
  final List<String> allergens;

  factory MenuDish.fromMap(Map<String, dynamic> m) =>
      MenuDish(name: _s(m['name']), allergens: _strs(m['allergens']));
}
