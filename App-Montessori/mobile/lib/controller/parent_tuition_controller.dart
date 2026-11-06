import 'dart:io';

import 'package:get/get.dart';

import '../models/data_models/parent_models.dart';
import '../services/network/app_exception.dart';
import 'parent_load.dart';
import 'scope_aware.dart';

/// Totals shown on P05: current period and older debt are kept SEPARATE.
class TuitionSummary {
  const TuitionSummary({required this.open, this.current, this.older = const []});

  final List<Receivable> open;

  /// Newest open period.
  final Receivable? current;
  final List<Receivable> older;

  int get total => open.fold(0, (a, r) => a + r.balance);
  int get currentTotal => current?.balance ?? 0;
  int get olderTotal => older.fold(0, (a, r) => a + r.balance);
  bool get hasDebt => total > 0;

  factory TuitionSummary.from(Iterable<Receivable> all) {
    final open = all.where((r) => r.isVisible && r.isOpen && r.balance > 0).toList()
      ..sort((a, b) => b.periodKey.compareTo(a.periodKey));
    if (open.isEmpty) return const TuitionSummary(open: []);
    return TuitionSummary(open: open, current: open.first, older: open.skip(1).toList());
  }
}

/// P05: fees of the selected child and "I have transferred" receipts.
class ParentTuitionController extends GetxController with ScopeAware, ParentLoad {
  final RxList<Receivable> receivables = <Receivable>[].obs;
  final RxList<PaymentRecord> payments = <PaymentRecord>[].obs;
  final Rxn<BankInfo> bank = Rxn<BankInfo>();
  final RxBool loaded = false.obs;

  @override
  void onInit() {
    super.onInit();
    load();
  }

  @override
  bool get hasData => loaded.value;

  TuitionSummary get summary => TuitionSummary.from(receivables);

  List<PaymentRecord> get pendingProofs => payments.where((p) => p.isPendingProof).toList();

  List<Receivable> get paid =>
      receivables.where((r) => r.isVisible && !r.isOpen).toList()
        ..sort((a, b) => b.periodKey.compareTo(a.periodKey));

  @override
  void onScopeChanged() {
    clearData();
    load();
  }

  @override
  void clearData() {
    receivables.clear();
    payments.clear();
    bank.value = null;
    loaded.value = false;
  }

  @override
  Future<bool> fetch() async {
    final cid = childId!;
    final r = await repo.receivables(cid);
    var cached = r.fromCache;
    receivables.assignAll(r.items.where((x) => x.isVisible));
    try {
      final p = await repo.payments(cid);
      cached = cached || p.fromCache;
      payments.assignAll(p.items);
    } catch (_) {
      payments.clear();
    }
    try {
      bank.value = await repo.bankInfo();
    } catch (_) {
      bank.value = null;
    }
    loaded.value = true;
    return cached;
  }

  /// Uploads [image] then calls `payment.submitProof`. Both steps reuse the
  /// same [opId] so a retry does not create a second proof. Returns normally
  /// only after the server confirmed; the proof stays `pending_reconciliation`.
  Future<void> submitProof({
    required int amount,
    required File image,
    required String opId,
    String note = '',
  }) async {
    final cid = childId;
    if (cid == null) throw const AppException(AppException.permissionDenied, '');
    final path = await repo.uploadProof(image, uid: uid, opId: opId);
    await write('payment.submitProof', {
      'childId': cid,
      'amount': amount,
      'imagePath': path,
      if (note.isNotEmpty) 'note': note,
    }, opId: opId);
    await load();
  }
}
