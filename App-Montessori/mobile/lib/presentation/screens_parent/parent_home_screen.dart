import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/parent_home_controller.dart';
import '../../controller/parent_tuition_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/parent_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../utils/date_formatter.dart';
import '../../utils/money_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_parent.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import 'daily_log_view.dart';
import 'parent_widgets.dart';

/// P01: home by child. Status at school, quick actions, today's published
/// diary, fees due and the latest notification. Nothing is shown "as if" it
/// happened: every block comes from real documents.
class ParentHomeTab extends StatelessWidget {
  const ParentHomeTab({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Get.put(ParentHomeController());
    final s = SessionController.to;
    return ScreenScaffold(
        showAppBar: false,
        inShell: true,
        header: CappedHeader(child: _Greeting(c: c)),
        body: ParentStateView(
          controller: c,
          emptyTitle: 'p01_no_child_title'.tr,
          emptyMessage: 'p01_no_child_message'.tr,
          emptyIcon: AppIcons.child,
          builder: () => ParentList(onRefresh: c.load, children: _content(c, s)),
        ),
      );
  }

  List<Widget> _content(ParentHomeController c, SessionController s) {
    final childName = s.child?.fullName ?? '';
    final t = c.tuition;
    return [
      if (c.partialFailure.value) ...[
        AppBanner(
          tone: AppTone.warning,
          message: 'p01_partial_failure'.tr,
          actionLabel: 'action_retry'.tr,
          onAction: c.load,
        ),
        const SizedBox(height: AppDimens.s3),
      ],
      _SchoolStatus(handover: c.handover.value, attendance: c.attendance.value),
      const SizedBox(height: AppDimens.s4),
      const _QuickActions(),
      const SizedBox(height: AppDimens.s5),
      ParentSectionHeader(
        title: 'p01_today_of'.trParams({'args1': childName}),
        actionLabel: 'p01_see_all'.tr,
        onAction: () => Get.toNamed<void>(RouteParent.diary),
      ),
      if (c.todayLog.value == null)
        AppCard(
          child: AppText('p01_no_log_today'.tr, style: AppTypography.bodySmall),
        )
      else
        DailyLogBody(log: c.todayLog.value!, compact: true),
      const SizedBox(height: AppDimens.s4),
      if (!c.feesForbidden.value) ...[
        _TuitionCard(summary: t, hasAny: c.receivables.isNotEmpty, today: c.today),
        const SizedBox(height: AppDimens.s4),
      ],
      _LatestNotification(item: c.latestNotification),
    ];
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.c});

  final ParentHomeController c;

  @override
  Widget build(BuildContext context) {
    final s = SessionController.to;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Semantics(
                    header: true,
                    child: AppText(
                      'p01_greeting'.trParams({'args1': s.displayName.value}),
                      style: AppTypography.heading2,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (s.campusName.isNotEmpty)
                    AppText(s.campusName, style: AppTypography.bodySmall, maxLines: 2),
                ],
              ),
            ),
            Obx(() {
              final n = c.unread;
              return Semantics(
                label: n > 0
                    ? 'p01_bell_unread'.trParams({'args1': '$n'})
                    : 'p01_bell'.tr,
                button: true,
                child: InkResponse(
                  onTap: () => Get.toNamed<void>(RouteParent.inbox),
                  radius: AppDimens.touchMin / 2,
                  child: SizedBox(
                    width: AppDimens.touchMin,
                    height: AppDimens.touchMin,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        const Icon(AppIcons.bell, size: AppDimens.iconLg),
                        if (n > 0)
                          Positioned(
                            top: AppDimens.s1,
                            right: AppDimens.s0,
                            child: AppBadge(
                              label: n > 9 ? '9+' : '$n',
                              tone: AppTone.error,
                              showIcon: false,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ],
        ),
        const SizedBox(height: AppDimens.s3),
        const ParentScopeHeader(),
      ],
    );
  }
}

class _SchoolStatus extends StatelessWidget {
  const _SchoolStatus({required this.handover, required this.attendance});

  final HandoverInfo? handover;
  final AttendanceInfo? attendance;

  @override
  Widget build(BuildContext context) {
    String? title;
    String? message;
    IconData icon = AppIcons.school;
    var tone = AppTone.success;
    final h = handover;
    if (h != null && h.state == 'picked_up' && h.pickedAt != null) {
      title = 'p01_picked_title'.tr;
      message = h.pickupPersonName == null
          ? 'p01_picked_at'.trParams({'args1': campusTime(h.pickedAt!)})
          : 'p01_picked_at_by'.trParams({
              'args1': campusTime(h.pickedAt!),
              'args2': h.pickupPersonName!,
            });
      icon = AppIcons.pickup;
      tone = AppTone.info;
    } else if (h != null && h.state == 'received' && h.receivedAt != null) {
      title = 'p01_at_school'.tr;
      message = h.receivedByName == null
          ? 'p01_received_at'.trParams({'args1': campusTime(h.receivedAt!)})
          : 'p01_received_at_by'.trParams({
              'args1': campusTime(h.receivedAt!),
              'args2': h.receivedByName!,
            });
    } else if (attendance != null && attendance!.status.startsWith('absent')) {
      title = 'p01_absent_title'.tr;
      message = (attendance!.status == 'absent_excused' ? 'status_attendance_absent_excused' : 'status_attendance_absent_unexcused').tr;
      icon = AppIcons.calendar;
      tone = AppTone.warning;
    }
    if (title == null) {
      return AppText(
        'p01_no_update'.tr,
        style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
      );
    }
    return AppCard(
      color: tone == AppTone.success ? AppColors.brandSoft : null,
      child: Row(
        children: [
          ToneIcon(icon: icon, tone: tone),
          const SizedBox(width: AppDimens.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppText(title, style: AppTypography.title),
                AppText(message!, style: AppTypography.body),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions();

  @override
  Widget build(BuildContext context) {
    final items = <(IconData, String, AppTone, String)>[
      (AppIcons.calendar, 'p01_qa_leave', AppTone.error, RouteParent.leave),
      (AppIcons.diary, 'p01_qa_note', AppTone.success, RouteParent.noteForm),
      (AppIcons.pickup, 'p01_qa_pickup', AppTone.warning, RouteParent.pickup),
      (AppIcons.money, 'p01_qa_tuition', AppTone.info, RouteParent.tuition),
    ];
    final scale = MediaQuery.textScalerOf(context).scale(16) / 16;
    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: AppDimens.s3, horizontal: AppDimens.s2),
      child: LayoutBuilder(
        builder: (context, box) {
          final perRow = scale > 1.3 ? 2 : 4;
          final w = box.maxWidth / perRow;
          return Wrap(
            children: [
              for (final it in items)
                SizedBox(
                  width: w,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(AppDimens.radiusMd),
                    onTap: () => Get.toNamed<void>(it.$4),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: AppDimens.s2,
                          horizontal: AppDimens.s1,
                        ),
                        child: Column(
                          children: [
                            ToneIcon(icon: it.$1, tone: it.$3),
                            const SizedBox(height: AppDimens.s2),
                            AppText(
                              it.$2.tr,
                              style: AppTypography.label,
                              textAlign: TextAlign.center,
                              maxLines: 3,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// `YYYY-MM` -> month number as text ("10").
String periodMonth(String key) {
  final p = key.split('-');
  return p.length == 2 ? int.tryParse(p[1])?.toString() ?? key : key;
}

class _TuitionCard extends StatelessWidget {
  const _TuitionCard({required this.summary, required this.hasAny, required this.today});

  final TuitionSummary summary;
  final bool hasAny;
  final String today;

  @override
  Widget build(BuildContext context) {
    if (!summary.hasDebt) {
      if (!hasAny) return const SizedBox.shrink();
      return AppCard(
        child: Row(
          children: [
            const ToneIcon(icon: AppIcons.check, size: AppDimens.s10),
            const SizedBox(width: AppDimens.s3),
            Expanded(child: AppText('p01_no_debt'.tr, style: AppTypography.bodyStrong)),
          ],
        ),
      );
    }
    final cur = summary.current!;
    final total = summary.total;
    final older = summary.olderTotal;
    String? due;
    var overdue = false;
    final dueDay = DateFormatter.parseDayKey(cur.dueDate);
    final todayDay = DateFormatter.parseDayKey(today);
    if (dueDay != null && todayDay != null) {
      final diff = dueDay.difference(todayDay).inDays;
      if (diff >= 0) {
        due = 'p01_due_in'.trParams({'args1': '$diff', 'args2': DateFormatter.date(dueDay)});
      } else {
        overdue = true;
        due = 'p01_overdue_since'.trParams({'args1': DateFormatter.date(dueDay)});
      }
    }
    return AppCard(
      color: AppColors.warningSoft,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppText(
            'p01_tuition_month'.trParams({'args1': periodMonth(cur.periodKey)}),
            style: AppTypography.title,
          ),
          if (due != null)
            AppText(
              due,
              style: AppTypography.body.copyWith(
                color: overdue ? AppColors.error : AppColors.warning,
              ),
            ),
          const SizedBox(height: AppDimens.s2),
          BigAmount(MoneyFormatter.format(total)),
          if (older > 0)
            AppText(
              'p01_includes_older'.trParams({'args1': MoneyFormatter.format(older)}),
              style: AppTypography.bodySmall,
            ),
          if (cur.pendingReconciliation) ...[
            const SizedBox(height: AppDimens.s2),
            AppBadge(label: 'status_payment_pending_reconciliation'.tr, tone: AppTone.warning),
          ],
          const SizedBox(height: AppDimens.s3),
          AppButton(
            label: 'p01_view_detail'.tr,
            expand: true,
            onPressed: () => Get.toNamed<void>(RouteParent.tuition),
          ),
        ],
      ),
    );
  }
}

class _LatestNotification extends StatelessWidget {
  const _LatestNotification({required this.item});

  final NotificationItem? item;

  @override
  Widget build(BuildContext context) {
    final n = item;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ParentSectionHeader(
          title: 'p01_new_notice'.tr,
          actionLabel: 'p01_see_all'.tr,
          onAction: () => Get.toNamed<void>(RouteParent.inbox),
        ),
        if (n == null)
          AppCard(child: AppText('p01_no_notice'.tr, style: AppTypography.bodySmall))
        else
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
            child: ListRow(
              title: n.title.isEmpty ? 'p07_notif_untitled'.tr : n.title,
              subtitle: n.sentAt == null ? null : DateFormatter.date(n.sentAt!),
              trailing: n.isRead ? null : AppBadge(label: 'p07_unread'.tr, tone: AppTone.info),
              onTap: () => Get.toNamed<void>(RouteParent.notification, arguments: n.id),
            ),
          ),
      ],
    );
  }
}
