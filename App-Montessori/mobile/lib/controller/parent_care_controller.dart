import 'package:get/get.dart';

import '../models/data_models/parent_models.dart';
import '../services/network/api_service.dart';
import '../services/network/app_exception.dart';
import '../utils/date_formatter.dart';
import 'parent_load.dart';
import 'scope_aware.dart';

/// P03: leave requests, medication requests and care notes of the child.
/// Every write waits for the server; nothing is queued offline.
class ParentCareController extends GetxController with ScopeAware, ParentLoad {
  final RxList<LeaveRequest> leaves = <LeaveRequest>[].obs;
  final RxList<MedicationRequest> medications = <MedicationRequest>[].obs;
  final RxBool loaded = false.obs;

  @override
  void onInit() {
    super.onInit();
    load();
  }

  @override
  bool get hasData => loaded.value;

  @override
  void onScopeChanged() {
    clearData();
    load();
  }

  @override
  void clearData() {
    leaves.clear();
    medications.clear();
    loaded.value = false;
  }

  /// Newest first.
  List<LeaveRequest> get sortedLeaves => [...leaves]
    ..sort((a, b) => (b.submittedAt ?? DateTime(0)).compareTo(a.submittedAt ?? DateTime(0)));

  List<MedicationRequest> get sortedMedications =>
      [...medications]..sort((a, b) => (b.fromDay ?? '').compareTo(a.fromDay ?? ''));

  @override
  Future<bool> fetch() async {
    final cid = childId!;
    final l = await repo.leaves(cid);
    var cached = l.fromCache;
    leaves.assignAll(l.items);
    try {
      final m = await repo.medications(cid);
      cached = cached || m.fromCache;
      medications.assignAll(m.items);
    } catch (e) {
      // Medication may be unreadable for some accounts; leave list still works.
      medications.clear();
    }
    loaded.value = true;
    return cached;
  }

  /// Local validation shared by the form and tests. Returns field -> message key.
  static Map<String, String> validateLeave({
    required DateTime? from,
    required DateTime? to,
    required String? reasonId,
    required String todayKey,
  }) {
    final e = <String, String>{};
    final today = DateFormatter.parseDayKey(todayKey);
    if (from == null) {
      e['fromDay'] = 'error_required';
    } else if (today != null && from.isBefore(today)) {
      e['fromDay'] = 'p03_error_past';
    }
    if (to == null) {
      e['toDay'] = 'error_required';
    } else if (from != null && to.isBefore(from)) {
      e['toDay'] = 'error_date_range';
    } else if (from != null && to.difference(from).inDays >= 60) {
      e['toDay'] = 'p03_error_too_long';
    }
    if (reasonId == null || reasonId.isEmpty) e['reasonId'] = 'error_required';
    return e;
  }

  Future<void> submitLeave({
    required DateTime from,
    required DateTime to,
    required String session,
    required String reasonId,
    String reasonText = '',
    String note = '',
    required String opId,
  }) async {
    await write('leave.submit', {
      'childId': childId,
      'fromDay': DateFormatter.dayKey(from),
      'toDay': DateFormatter.dayKey(to),
      'session': session,
      'reasonId': reasonId,
      if (reasonText.isNotEmpty) 'reasonText': reasonText,
      'note': note,
    }, opId: opId);
    await load();
  }

  Future<void> cancelLeave(String id) async {
    await write('leave.cancel', {'id': id}, opId: ApiService.newOpId());
    await load();
  }

  Future<void> submitMedication({
    required String medicineName,
    required String dose,
    required List<String> times,
    required DateTime from,
    required DateTime to,
    required String instructions,
    String reason = '',
    String storage = '',
    required String opId,
  }) async {
    await write('medication.request', {
      'childId': childId,
      'medicineName': medicineName,
      'dose': dose,
      'times': times,
      'fromDay': DateFormatter.dayKey(from),
      'toDay': DateFormatter.dayKey(to),
      'instructions': instructions,
      if (reason.isNotEmpty) 'reason': reason,
      if (storage.isNotEmpty) 'storage': storage,
    }, opId: opId);
    await load();
  }

  /// Care note ("Dặn dò") = a conversation with the class teacher/school.
  Future<void> sendNote({
    required String subject,
    required String text,
    required String opId,
  }) async {
    if (childId == null) {
      throw const AppException(AppException.permissionDenied, '');
    }
    await write('thread.open', {
      'childId': childId,
      'subject': subject,
      'priority': 'normal',
      'text': text,
    }, opId: opId);
  }
}

