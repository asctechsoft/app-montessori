import 'package:get/get.dart';

import '../models/data_models/parent_models.dart';
import '../utils/date_formatter.dart';
import 'parent_load.dart';
import 'scope_aware.dart';

/// P02: published diary of the last [days] days + the published menu of the
/// selected day.
class ParentDiaryController extends GetxController with ScopeAware, ParentLoad {
  static const int days = 14;

  final RxMap<String, DailyLog> logs = <String, DailyLog>{}.obs;
  final Rxn<MenuDay> menu = Rxn<MenuDay>();
  final RxString selectedDay = ''.obs;
  final RxBool loaded = false.obs;

  @override
  void onInit() {
    super.onInit();
    selectedDay.value = today;
    load();
  }

  @override
  bool get hasData => loaded.value;

  /// Newest first.
  List<String> get dayKeys {
    final now = DateFormatter.parseDayKey(today) ?? DateTime.now();
    return [
      for (var i = 0; i < days; i++)
        DateFormatter.dayKey(DateTime(now.year, now.month, now.day - i)),
    ];
  }

  DailyLog? get selectedLog => logs[selectedDay.value];

  Future<void> select(String day) async {
    selectedDay.value = day;
    await _loadMenu();
  }

  Future<void> _loadMenu() async {
    final day = selectedDay.value;
    try {
      final s = await repo.publishedMenu(day);
      if (selectedDay.value == day) menu.value = s.items.isEmpty ? null : s.items.first;
    } catch (_) {
      if (selectedDay.value == day) menu.value = null;
    }
  }

  @override
  void onScopeChanged() {
    clearData();
    selectedDay.value = today;
    load();
  }

  @override
  void clearData() {
    logs.clear();
    menu.value = null;
    loaded.value = false;
  }

  @override
  Future<bool> fetch() async {
    final s = await repo.publishedLogs(childId!, dayKeys);
    logs.assignAll({for (final l in s.items) l.dayKey: l});
    loaded.value = true;
    await _loadMenu();
    return s.fromCache;
  }
}
