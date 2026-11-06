import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/parent_diary_controller.dart';
import '../../models/data_models/parent_models.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/screen_scaffold.dart';
import 'daily_log_view.dart';
import 'parent_widgets.dart';

/// P02: diary and activities (published logs, photos, published menu).
class ParentDiaryScreen extends StatelessWidget {
  const ParentDiaryScreen({super.key, this.inShell = true});

  /// True inside the bottom-nav tab; false when pushed (shows back).
  final bool inShell;

  @override
  Widget build(BuildContext context) {
    final c = Get.put(ParentDiaryController());
    return Obx(
      () => ScreenScaffold(
        title: 'tab_diary'.tr,
        showBack: !inShell,
        inShell: inShell,
        contextLabels: parentContextLabels(),
        header: const ParentScopeHeader(),
        body: ParentStateView(
          controller: c,
          emptyTitle: 'p01_no_child_title'.tr,
          emptyMessage: 'p01_no_child_message'.tr,
          emptyIcon: AppIcons.child,
          builder: () => ParentList(
            onRefresh: c.load,
            children: [
              _DayStrip(c: c),
              const SizedBox(height: AppDimens.s4),
              Semantics(
                header: true,
                child: AppText(
                  dayWithWeekday(c.selectedDay.value),
                  style: AppTypography.title,
                ),
              ),
              const SizedBox(height: AppDimens.s3),
              if (c.selectedLog == null)
                AppCard(child: AppText('p02_no_log'.tr, style: AppTypography.bodySmall))
              else
                DailyLogBody(log: c.selectedLog!),
              const SizedBox(height: AppDimens.s4),
              _MenuCard(menu: c.menu.value),
            ],
          ),
        ),
      ),
    );
  }
}

class _DayStrip extends StatelessWidget {
  const _DayStrip({required this.c});

  final ParentDiaryController c;

  @override
  Widget build(BuildContext context) {
    final keys = c.dayKeys;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final k in keys)
            Padding(
              padding: const EdgeInsets.only(right: AppDimens.s2),
              child: _DayChip(
                dayKey: k,
                selected: k == c.selectedDay.value,
                hasLog: c.logs.containsKey(k),
                onTap: () => c.select(k),
              ),
            ),
        ],
      ),
    );
  }
}

class _DayChip extends StatelessWidget {
  const _DayChip({
    required this.dayKey,
    required this.selected,
    required this.hasLog,
    required this.onTap,
  });

  final String dayKey;
  final bool selected;
  final bool hasLog;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final d = DateFormatter.parseDayKey(dayKey);
    final label = d == null ? dayKey : '${d.day}/${d.month}';
    return Semantics(
      button: true,
      selected: selected,
      label: '${dayWithWeekday(dayKey)}${hasLog ? ', ${'p02_has_log'.tr}' : ''}',
      child: InkWell(
        borderRadius: BorderRadius.circular(AppDimens.radiusMd),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(
            minWidth: AppDimens.touchMin + AppDimens.s2,
            minHeight: AppDimens.touchMin,
          ),
          padding: const EdgeInsets.symmetric(horizontal: AppDimens.s3, vertical: AppDimens.s2),
          decoration: BoxDecoration(
            color: selected ? AppColors.brandSoft : AppColors.surface,
            borderRadius: BorderRadius.circular(AppDimens.radiusMd),
            border: Border.all(
              color: selected ? AppColors.brand : AppColors.borderSubtle,
              width: selected ? AppDimens.focusStroke : AppDimens.hairline,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppText(label, style: AppTypography.label),
              if (hasLog)
                const Icon(AppIcons.check, size: AppDimens.iconSm, color: AppColors.success)
              else
                const SizedBox(height: AppDimens.iconSm),
            ],
          ),
        ),
      ),
    );
  }
}

class _MenuCard extends StatelessWidget {
  const _MenuCard({required this.menu});

  final MenuDay? menu;

  @override
  Widget build(BuildContext context) {
    final m = menu;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ParentSectionHeader(title: 'p02_menu'.tr),
        if (m == null || m.meals.isEmpty)
          AppCard(child: AppText('p02_no_menu'.tr, style: AppTypography.bodySmall))
        else
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final meal in m.meals) ...[
                  AppText(_mealTitle(meal.session), style: AppTypography.label),
                  for (final d in meal.dishes)
                    AppText(
                      d.allergens.isEmpty
                          ? d.name
                          : '${d.name} (${'p02_allergens'.trParams({'args1': d.allergens.join(', ')})})',
                      style: AppTypography.body,
                    ),
                  const SizedBox(height: AppDimens.s2),
                ],
              ],
            ),
          ),
      ],
    );
  }

  String _mealTitle(String s) => switch (s) {
    'breakfast' => 'p02_meal_breakfast'.tr,
    'lunch' => 'p02_meal_lunch'.tr,
    'snack' => 'p02_meal_snack'.tr,
    'dinner' => 'p02_meal_dinner'.tr,
    _ => s,
  };
}
