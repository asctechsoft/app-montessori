import 'package:get/get.dart';

import '../models/data_models/parent_models.dart';
import '../services/network/api_service.dart';
import '../utils/date_formatter.dart';
import 'parent_load.dart';
import 'scope_aware.dart';

/// P04: who may pick the child up, temporary delegations and revoking them.
class ParentPickupController extends GetxController with ScopeAware, ParentLoad {
  final RxList<PickupAuth> auths = <PickupAuth>[].obs;
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
    auths.clear();
    loaded.value = false;
  }

  /// Linked guardians (always allowed while linked).
  List<PickupAuth> get guardians =>
      auths.where((a) => a.isGuardian && a.status != 'revoked').toList();

  /// Temporary delegations: pending/active first, then ended ones.
  List<PickupAuth> get delegates {
    final l = auths.where((a) => !a.isGuardian).toList();
    int rank(PickupAuth a) => switch (a.effectiveStatus(today)) {
      'pending' => 0,
      'approved' => 1,
      'scheduled' => 2,
      _ => 3,
    };
    l.sort((a, b) {
      final r = rank(a).compareTo(rank(b));
      return r != 0 ? r : (b.validTo ?? '').compareTo(a.validTo ?? '');
    });
    return l;
  }

  @override
  Future<bool> fetch() async {
    final s = await repo.pickupAuths(childId!);
    auths.assignAll(s.items);
    loaded.value = true;
    return s.fromCache;
  }

  /// `pickupAuth.save`: a parent's delegation starts `pending` and only counts
  /// once the school approves it.
  Future<void> save({
    String? id,
    required String personName,
    required String relation,
    String phone = '',
    String idLast4 = '',
    required DateTime validFrom,
    required DateTime validTo,
    String note = '',
    required String opId,
  }) async {
    await write('pickupAuth.save', {
      'id': ?id,
      'childId': childId,
      'personName': personName,
      'relation': relation,
      if (phone.isNotEmpty) 'phone': phone,
      if (idLast4.isNotEmpty) 'idNumberLast4': idLast4,
      'validFrom': DateFormatter.dayKey(validFrom),
      'validTo': DateFormatter.dayKey(validTo),
      if (note.isNotEmpty) 'note': note,
    }, opId: opId);
    await load();
  }

  Future<void> revoke(String id, String reason) async {
    await write('pickupAuth.revoke', {'id': id, 'reason': reason}, opId: ApiService.newOpId());
    await load();
  }
}
