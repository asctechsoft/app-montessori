import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../models/data_models/parent_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import 'parent_widgets.dart';

String _first(Map<String, dynamic> m, List<String> keys) {
  for (final k in keys) {
    final v = m[k];
    if (v != null && v.toString().trim().isNotEmpty) return v.toString().trim();
  }
  return '';
}

String _mealName(Map<String, dynamic> m) {
  final raw = _first(m, ['slot', 'session', 'meal', 'name', 'type']);
  return switch (raw) {
    'breakfast' => 'p02_meal_breakfast'.tr,
    'lunch' => 'p02_meal_lunch'.tr,
    'snack' => 'p02_meal_snack'.tr,
    'dinner' => 'p02_meal_dinner'.tr,
    _ => raw,
  };
}

/// Lines of the "meals" block; only what the teacher actually wrote.
List<String> mealLines(DailyLog log) {
  final out = <String>[];
  for (final m in log.meals) {
    final name = _mealName(m);
    final amount = _first(m, ['amount', 'level', 'ate', 'appetite', 'status']);
    final amountKey = switch (amount) {
      'all' => 't_meal_level_all',
      'most' => 't_meal_level_most',
      'half' => 't_meal_level_half',
      'little' => 't_meal_level_little',
      'none' => 't_meal_level_none',
      _ => null,
    };
    final detail = [amountKey != null ? amountKey.tr : amount, _first(m, ['note'])].where((e) => e.isNotEmpty).join(' · ');
    final line = [name, detail].where((e) => e.isNotEmpty).join(' · ');
    if (line.isNotEmpty) out.add(line);
  }
  return out;
}

List<String> sleepLines(DailyLog log) {
  final out = <String>[];
  for (final m in log.sleep) {
    final from = _first(m, ['from', 'start']);
    final to = _first(m, ['to', 'end']);
    final range = from.isNotEmpty && to.isNotEmpty ? '$from – $to' : '';
    final detail = _first(m, ['quality', 'note', 'duration']);
    final line = [range, detail].where((e) => e.isNotEmpty).join(' · ');
    if (line.isNotEmpty) out.add(line);
  }
  return out;
}

List<String> hygieneLines(DailyLog log) {
  const labels = {
    'toilet': 'p02_hyg_toilet',
    'diaper': 'p02_hyg_diaper',
    'bath': 'p02_hyg_bath',
    'handWash': 'p02_hyg_hands',
    'note': 'p02_hyg_note',
  };
  final out = <String>[];
  for (final e in log.hygiene.entries) {
    final key = labels[e.key];
    final v = e.value;
    if (key == null || v == null || v == false || v.toString().trim().isEmpty) continue;
    out.add(v == true ? key.tr : '${key.tr}: $v');
  }
  return out;
}

String? moodText(DailyLog log) {
  final m = log.mood;
  if (m == null) return null;
  return switch (m) {
    'happy' => 'p02_mood_happy'.tr,
    'calm' => 'p02_mood_calm'.tr,
    'tired' => 'p02_mood_tired'.tr,
    'fussy' => 'p02_mood_fussy'.tr,
    _ => m,
  };
}

/// Blocks of one published diary: only data that exists is shown, never a
/// default like "ate well" for a missing field.
class DailyLogBody extends StatelessWidget {
  const DailyLogBody({super.key, required this.log, this.compact = false});

  final DailyLog log;

  /// Compact (home): no photos and no teacher note.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final blocks = <Widget>[];
    void block(IconData icon, String titleKey, List<String> lines, AppTone tone) {
      if (lines.isEmpty) return;
      blocks.add(
        AppCard(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ToneIcon(icon: icon, tone: tone, size: AppDimens.s10),
              const SizedBox(width: AppDimens.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppText(titleKey.tr, style: AppTypography.label),
                    const SizedBox(height: AppDimens.s1),
                    for (final l in lines) AppText(l, style: AppTypography.body),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
      blocks.add(const SizedBox(height: AppDimens.s3));
    }

    block(AppIcons.meal, 'p02_meals', mealLines(log), AppTone.success);
    block(AppIcons.sleep, 'p02_sleep', sleepLines(log), AppTone.info);
    block(AppIcons.health, 'p02_hygiene', hygieneLines(log), AppTone.neutral);
    final mood = moodText(log);
    block(AppIcons.child, 'p02_mood', mood == null ? [] : [mood], AppTone.warning);
    block(AppIcons.diary, 'p02_activities', log.activities, AppTone.success);
    if (!compact) {
      block(
        AppIcons.email,
        'p02_teacher_note',
        log.note == null ? [] : [log.note!],
        AppTone.info,
      );
      if (log.photoPaths.isNotEmpty) {
        blocks.add(AppText('p02_photos'.tr, style: AppTypography.label));
        blocks.add(const SizedBox(height: AppDimens.s2));
        for (final p in log.photoPaths) {
          blocks.add(StoragePhoto(path: p));
          blocks.add(const SizedBox(height: AppDimens.s3));
        }
      }
    }
    if (blocks.isEmpty) {
      return AppText(
        'p02_log_without_details'.tr,
        style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: blocks);
  }
}
