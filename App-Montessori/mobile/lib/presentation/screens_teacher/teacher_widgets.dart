import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/session_controller.dart';
import '../../controller/teacher_common.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/app_exception.dart';
import '../../utils/toast_utils.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_input.dart';
import '../common_components/bottom_sheet_base.dart';
import '../common_components/app_icons.dart';
import '../common_components/status_view.dart';
import '../../utils/date_formatter.dart';
import '../screen_shell/placeholder_tab.dart';

/// Context strip labels (org, campus) for teacher screens.
List<String> teacherContext() => PlaceholderTab.contextLabels(SessionController.to);

/// Maps a server error to `fieldErrors` of the form (key -> message) plus a
/// general message; keeps what the user typed.
class FormErrors {
  FormErrors([this.fields = const {}, this.general]);
  final Map<String, String> fields;
  final String? general;

  factory FormErrors.from(Object e) {
    final ex = e is AppException ? e : AppException(AppException.unknown, e.toString());
    final f = <String, String>{};
    ex.fieldErrors.forEach((k, v) => f[k] = v);
    return FormErrors(f, ex.fieldErrors.isEmpty ? ex.userMessage : null);
  }

  String? of(String key) => fields[key];
}

/// "Saved but not confirmed yet" toast text helper.
void teacherToast(String message, {AppTone tone = AppTone.success}) =>
    AppToast.show(message, tone: tone);

/// A horizontal group of single-choice chips (each >= 48 high).
class ChoiceChips extends StatelessWidget {
  const ChoiceChips({
    super.key,
    required this.options,
    required this.value,
    required this.labelOf,
    required this.onChanged,
  });

  final List<String> options;
  final String? value;
  final String Function(String) labelOf;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppDimens.s2,
      runSpacing: AppDimens.s2,
      children: [
        for (final o in options)
          Semantics(
            button: true,
            selected: o == value,
            child: AppTouchable(
              onTap: () => onChanged(o),
              borderRadius: BorderRadius.circular(AppDimens.radiusPill),
              pressedScale: 1,
              child: Container(
                constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
                padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4, vertical: AppDimens.s2),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: o == value ? AppColors.brandSoft : AppColors.surface,
                  borderRadius: BorderRadius.circular(AppDimens.radiusPill),
                  border: Border.all(
                    color: o == value ? AppColors.brand : AppColors.borderControl,
                    width: o == value ? 2 : 1,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (o == value) ...[
                      const Icon(AppIcons.check, size: AppDimens.iconSm, color: AppColors.brand),
                      const SizedBox(width: AppDimens.s1),
                    ],
                    Flexible(
                      child: AppText(
                        labelOf(o),
                        style: AppTypography.label.copyWith(
                          color: o == value ? AppColors.brand : AppColors.textPrimary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Two or three way segmented control (each segment >= 48 high).
class SegmentBar extends StatelessWidget {
  const SegmentBar({super.key, required this.labels, required this.index, required this.onChanged});

  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppDimens.s1),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppDimens.radiusMd),
      ),
      child: Row(
        children: [
          for (var i = 0; i < labels.length; i++)
            Expanded(
              child: Semantics(
                button: true,
                selected: i == index,
                child: AppTouchable(
                  onTap: () => onChanged(i),
                  borderRadius: BorderRadius.circular(AppDimens.radiusSm),
                  pressedScale: 1,
                  child: Container(
                    constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
                    padding: const EdgeInsets.symmetric(horizontal: AppDimens.s2, vertical: AppDimens.s2),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: i == index ? AppColors.brandSoft : Colors.transparent,
                      borderRadius: BorderRadius.circular(AppDimens.radiusSm),
                    ),
                    child: AppText(
                      labels[i],
                      textAlign: TextAlign.center,
                      style: AppTypography.label.copyWith(
                        color: i == index ? AppColors.brand : AppColors.textSecondary,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// "Label: value" row that wraps for large text.
class InfoLine extends StatelessWidget {
  const InfoLine({super.key, required this.label, required this.value, this.icon});

  final String label;
  final String value;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppDimens.s1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Icon(icon, size: AppDimens.iconMd, color: AppColors.brand),
            const SizedBox(width: AppDimens.s2),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppText(label, style: AppTypography.caption),
                AppText(value, style: AppTypography.body),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Badge for an allergy / health warning (text + icon).
class HealthAlertBadge extends StatelessWidget {
  const HealthAlertBadge({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) =>
      AppBadge(label: text, tone: AppTone.error, icon: Icons.warning_amber_rounded);
}

/// Banner for a server rejection with its message.
class ErrorBanner extends StatelessWidget {
  const ErrorBanner(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) => AppBanner(message: message, tone: AppTone.error);
}

/// Section title.
class TeacherSection extends StatelessWidget {
  const TeacherSection(this.title, {super.key});
  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppDimens.s4, bottom: AppDimens.s2),
    child: Semantics(header: true, child: AppText(title, style: AppTypography.heading3)),
  );
}

/// Label for the `t_*` string of an enum-like code, falling back to the code.
String codeLabel(String prefix, String code) {
  final k = '$prefix$code';
  final v = k.tr;
  return v == k ? code : v;
}

/// Children of a scrolling page for a data [state]: the content when ready or
/// stale (with an offline banner), otherwise a bounded [StatusView] message.
/// Lets a page keep ONE ListView while still covering all 8 states.
List<Widget> stateChildren({
  required ViewState state,
  required List<Widget> Function() content,
  AppException? error,
  VoidCallback? onRetry,
  DateTime? staleSince,
  String? emptyTitle,
  String? emptyMessage,
  IconData? emptyIcon,
  List<String> activeFilters = const [],
  VoidCallback? onClearFilters,
  VoidCallback? onBack,
}) {
  if (state == ViewState.ready || state == ViewState.offlineStale) {
    return [
      if (state == ViewState.offlineStale) ...[
        AppBanner(
          tone: AppTone.warning,
          icon: AppIcons.offline,
          message: staleSince == null
              ? 'offline_stale_unknown'.tr
              : 'offline_stale_at'.trParams({'args1': DateFormatter.dateTime(staleSince)}),
          actionLabel: onRetry == null ? null : 'action_retry'.tr,
          onAction: onRetry,
        ),
        const SizedBox(height: AppDimens.s3),
      ],
      ...content(),
    ];
  }
  return [
    SizedBox(
      height: 420,
      child: StatusView(
        state: state,
        error: error,
        onRetry: onRetry,
        emptyTitle: emptyTitle,
        emptyMessage: emptyMessage,
        emptyIcon: emptyIcon,
        activeFilters: activeFilters,
        onClearFilters: onClearFilters,
        onBack: onBack,
      ),
    ),
  ];
}

/// Bottom sheet asking for a required text (reject reason, hold reason...).
/// Returns the trimmed text or null when cancelled.
Future<String?> askText({
  required String title,
  required String label,
  required String confirmLabel,
  int minLength = 3,
  String? helper,
}) {
  return BottomSheetBase.show<String>(
    title: title,
    builder: (_) => _AskTextForm(label: label, confirmLabel: confirmLabel, minLength: minLength, helper: helper),
  );
}

class _AskTextForm extends StatefulWidget {
  const _AskTextForm({required this.label, required this.confirmLabel, required this.minLength, this.helper});
  final String label;
  final String confirmLabel;
  final int minLength;
  final String? helper;

  @override
  State<_AskTextForm> createState() => _AskTextFormState();
}

class _AskTextFormState extends State<_AskTextForm> {
  final _c = TextEditingController();
  String? _err;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppInput(
          label: widget.label,
          controller: _c,
          kind: AppInputKind.multiline,
          required: true,
          helper: widget.helper,
          error: _err,
          autofocus: true,
        ),
        const SizedBox(height: AppDimens.s4),
        AppButton(
          label: widget.confirmLabel,
          onPressed: () {
            final t = _c.text.trim();
            if (t.length < widget.minLength) {
              setState(() => _err = 't_reason_required'.trParams({'args1': '${widget.minLength}'}));
              return;
            }
            Navigator.of(context).pop(t);
          },
        ),
      ],
    );
  }
}

/// Instant of a campus wall-clock [t] today (campus timezone, not the phone's).
DateTime campusTimeToInstant(TimeOfDay t, {DateTime? now}) {
  final clock = teacherClock();
  final w = clock.wall(now ?? DateTime.now());
  return DateTime.utc(w.year, w.month, w.day, t.hour, t.minute).subtract(clock.offset);
}

/// Current campus wall-clock time of day.
TimeOfDay campusNowOfDay() {
  final w = teacherClock().wall(DateTime.now());
  return TimeOfDay(hour: w.hour, minute: w.minute);
}

/// Name of the active campus.
String teacherCampusName() => SessionController.to.campusName;
