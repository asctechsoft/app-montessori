import 'package:get/get.dart';

import '../models/data_models/parent_models.dart';
import 'parent_load.dart';
import 'scope_aware.dart';

/// P06: growth measurements, allergy notes and the child's profile. Changing
/// the profile is a REQUEST the school verifies (a conversation), never a
/// direct edit.
class ParentHealthController extends GetxController with ScopeAware, ParentLoad {
  final RxList<HealthRecord> records = <HealthRecord>[].obs;
  final Rxn<ChildHealth> health = Rxn<ChildHealth>();
  final Rxn<ChildProfile> profile = Rxn<ChildProfile>();
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
    records.clear();
    health.value = null;
    profile.value = null;
    loaded.value = false;
  }

  List<HealthRecord> get sortedRecords =>
      [...records]..sort((a, b) => b.measuredOn.compareTo(a.measuredOn));

  @override
  Future<bool> fetch() async {
    final cid = childId!;
    final r = await repo.healthRecords(cid);
    var cached = r.fromCache;
    records.assignAll(r.items);
    try {
      final h = await repo.childHealth(cid);
      cached = cached || h.fromCache;
      health.value = h.items.isEmpty ? null : h.items.first;
    } catch (_) {
      health.value = null;
    }
    try {
      final p = await repo.childProfile(cid);
      profile.value = p.items.isEmpty ? null : p.items.first;
    } catch (_) {
      profile.value = null;
    }
    loaded.value = true;
    return cached;
  }

  Future<void> requestProfileUpdate({
    required String subject,
    required String text,
    required String opId,
  }) async {
    await write('thread.open', {
      'childId': childId,
      'subject': subject,
      'priority': 'normal',
      'text': text,
    }, opId: opId);
  }
}
