import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/parent_inbox_controller.dart';
import '../../controller/session_controller.dart';
import '../../models/data_models/parent_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/api_service.dart';
import '../../services/network/app_exception.dart';
import '../../utils/toast_utils.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_parent.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/list_row.dart';
import '../common_components/screen_scaffold.dart';
import 'parent_form.dart';
import 'parent_widgets.dart';

/// P07: notifications and conversations with the school.
class ParentInboxScreen extends StatefulWidget {
  const ParentInboxScreen({super.key, this.initialTab = 0});

  final int initialTab;

  @override
  State<ParentInboxScreen> createState() => _ParentInboxScreenState();
}

class _ParentInboxScreenState extends State<ParentInboxScreen> {
  late int tab = widget.initialTab;

  @override
  Widget build(BuildContext context) {
    final c = Get.put(ParentInboxController());
    return Obx(
      () => ScreenScaffold(
        title: 'screen_p07'.tr,
        contextLabels: parentContextLabels(),
        footer: tab == 1
            ? AppButton(
                label: 'p07_new_thread'.tr,
                icon: AppIcons.email,
                onPressed: () => Get.toNamed<void>(RouteParent.threadForm),
              )
            : null,
        body: ParentStateView(
          controller: c,
          emptyTitle: 'p07_empty_title'.tr,
          emptyMessage: 'p07_empty_message'.tr,
          emptyIcon: AppIcons.bell,
          builder: () => ParentList(
            onRefresh: c.load,
            children: [
              Wrap(
                spacing: AppDimens.s2,
                runSpacing: AppDimens.s2,
                children: [
                  ChoiceChip(
                    label: Text(
                      c.unread > 0
                          ? 'p07_tab_notices_n'.trParams({'args1': '${c.unread}'})
                          : 'p07_tab_notices'.tr,
                    ),
                    selected: tab == 0,
                    onSelected: (_) => setState(() => tab = 0),
                  ),
                  ChoiceChip(
                    label: Text('p07_tab_threads'.tr),
                    selected: tab == 1,
                    onSelected: (_) => setState(() => tab = 1),
                  ),
                ],
              ),
              const SizedBox(height: AppDimens.s3),
              if (tab == 0) ..._notices(c) else ..._threads(c),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _notices(ParentInboxController c) {
    final list = c.visibleNotifications;
    return [
      FilterChip(
        label: Text('p07_unread_only'.tr),
        selected: c.unreadOnly.value,
        onSelected: (v) => c.unreadOnly.value = v,
      ),
      const SizedBox(height: AppDimens.s3),
      if (list.isEmpty)
        // No-results state when a filter hides everything, empty otherwise.
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppText(
                c.unreadOnly.value ? 'no_results_title'.tr : 'p07_no_notices'.tr,
                style: AppTypography.bodyStrong,
              ),
              if (c.unreadOnly.value) ...[
                const SizedBox(height: AppDimens.s2),
                AppButton(
                  label: 'action_clear_filters'.tr,
                  variant: AppButtonVariant.secondary,
                  expand: false,
                  onPressed: () => c.unreadOnly.value = false,
                ),
              ],
            ],
          ),
        )
      else
        AppCard(
          padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
          child: Column(
            children: [
              for (final n in list)
                ListRow(
                  title: n.title.isEmpty ? 'p07_notif_untitled'.tr : n.title,
                  titleStyle: n.isRead ? null : AppTypography.bodyStrong,
                  subtitle: n.sentAt == null ? null : campusDateTime(n.sentAt!),
                  divider: true,
                  trailing: n.needsAck
                      ? AppBadge(label: 'p07_need_ack'.tr, tone: AppTone.warning)
                      : (n.isRead ? null : AppBadge(label: 'p07_unread'.tr, tone: AppTone.info)),
                  onTap: () => Get.toNamed<void>(RouteParent.notification, arguments: n.id),
                ),
            ],
          ),
        ),
    ];
  }

  List<Widget> _threads(ParentInboxController c) {
    final list = c.sortedThreads;
    if (list.isEmpty) {
      return [AppCard(child: AppText('p07_no_threads'.tr, style: AppTypography.bodySmall))];
    }
    return [
      AppCard(
        padding: const EdgeInsets.symmetric(horizontal: AppDimens.s4),
        child: Column(
          children: [
            for (final t in list)
              ListRow(
                title: t.subject,
                subtitle: t.lastMessageAt == null ? null : campusDateTime(t.lastMessageAt!),
                divider: true,
                trailing: AppBadge(
                  label: t.isClosed ? 'p07_thread_closed'.tr : 'p07_thread_open'.tr,
                  tone: t.isClosed ? AppTone.neutral : AppTone.success,
                ),
                onTap: () => Get.toNamed<void>(RouteParent.thread, arguments: t),
              ),
          ],
        ),
      ),
    ];
  }
}

/// One notification: opening marks it read (server-confirmed); notices that
/// require acknowledgement keep a visible "Cần xác nhận" until acknowledged.
class ParentNotificationScreen extends StatefulWidget {
  const ParentNotificationScreen({super.key, this.notificationId});

  final String? notificationId;

  @override
  State<ParentNotificationScreen> createState() => _ParentNotificationScreenState();
}

class _ParentNotificationScreenState extends State<ParentNotificationScreen> {
  late final ParentInboxController c = Get.isRegistered<ParentInboxController>()
      ? Get.find<ParentInboxController>()
      : Get.put(ParentInboxController());
  late final String id = widget.notificationId ?? (Get.arguments as String? ?? '');
  late Future<String> body = c.body(id);
  String? ackError;

  @override
  void initState() {
    super.initState();
    c.markRead(id).catchError((Object _) {});
  }

  Future<void> _ack() async {
    setState(() => ackError = null);
    try {
      await c.ack(id);
      AppToast.success('p07_acked'.tr);
    } catch (e) {
      final ex = e is AppException ? e : ApiService.normalizeError(e);
      if (mounted) setState(() => ackError = ex.userMessage);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final n = c.notifications.firstWhereOrNull((x) => x.id == id);
      return ScreenScaffold(
        title: 'p07_notice'.tr,
        footer: n != null && n.requireAck && n.ackAt == null
            ? AppButton(
                label: 'p07_ack'.tr,
                loadingLabel: 'state_sending'.tr,
                icon: AppIcons.check,
                onPressed: _ack,
              )
            : null,
        children: [
          if (n == null)
            AppBanner(tone: AppTone.warning, message: 'p07_notice_gone'.tr)
          else ...[
            AppText(n.title.isEmpty ? 'p07_notif_untitled'.tr : n.title, style: AppTypography.heading3),
            if (n.sentAt != null)
              AppText(campusDateTime(n.sentAt!), style: AppTypography.bodySmall),
            const SizedBox(height: AppDimens.s3),
            if (n.ackAt != null)
              AppBadge(label: 'p07_acked_badge'.tr, tone: AppTone.success)
            else if (n.requireAck)
              AppBadge(label: 'p07_need_ack'.tr, tone: AppTone.warning),
            if (ackError != null) ...[
              const SizedBox(height: AppDimens.s3),
              AppBanner(tone: AppTone.error, message: ackError!),
            ],
            const SizedBox(height: AppDimens.s4),
            FutureBuilder<String>(
              future: body,
              builder: (context, snap) {
                if (snap.hasError) {
                  return AppBanner(
                    tone: AppTone.error,
                    message: 'error_load_title'.tr,
                    actionLabel: 'action_retry'.tr,
                    onAction: () => setState(() => body = c.body(id)),
                  );
                }
                if (!snap.hasData) return const SkeletonBlock();
                return AppText(snap.data!, style: AppTypography.body);
              },
            ),
          ],
        ],
      );
    });
  }
}

/// Three skeleton lines while a body loads.
class SkeletonBlock extends StatelessWidget {
  const SkeletonBlock({super.key});

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (var i = 0; i < 3; i++)
        Container(
          height: AppDimens.s4,
          margin: const EdgeInsets.only(bottom: AppDimens.s2),
          decoration: BoxDecoration(
            color: AppColors.surfaceMuted,
            borderRadius: BorderRadius.circular(AppDimens.radiusSm),
          ),
        ),
    ],
  );
}

/// Messages of one conversation + composer. The typed text stays on failure
/// and the retry reuses the same `opId`.
class ParentThreadScreen extends StatefulWidget {
  const ParentThreadScreen({super.key, this.thread});

  final ThreadInfo? thread;

  @override
  State<ParentThreadScreen> createState() => _ParentThreadScreenState();
}

class _ParentThreadScreenState extends State<ParentThreadScreen> with ParentFormState {
  late final ThreadInfo thread = widget.thread ?? Get.arguments as ThreadInfo;
  late final ParentThreadController c = Get.put(
    ParentThreadController(thread),
    tag: thread.id,
  );
  final text = TextEditingController();

  @override
  bool get isDirty => text.text.trim().isNotEmpty;

  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!setLocalErrors({if (text.text.trim().isEmpty) 'text': 'error_required'})) return;
    await send(() => c.send(text.text.trim(), opId: opId), onDone: () => setState(text.clear));
  }

  @override
  Widget build(BuildContext context) {
    final me = SessionController.to.uid.value;
    return ScreenScaffold(
      title: thread.subject,
      footer: thread.isClosed
          ? AppText('p07_thread_closed_note'.tr, style: AppTypography.bodySmall)
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (formError != null) ...[
                  AppBanner(tone: AppTone.error, message: formError!),
                  const SizedBox(height: AppDimens.s2),
                ],
                AppInput(
                  label: 'p07_message'.tr,
                  controller: text,
                  kind: AppInputKind.multiline,
                  maxLength: 4000,
                  error: fieldErrors['text'],
                  onChanged: (_) => renewOp(),
                ),
                const SizedBox(height: AppDimens.s2),
                AppButton(
                  label: 'p07_send'.tr,
                  loadingLabel: 'state_sending'.tr,
                  icon: AppIcons.email,
                  onPressed: _send,
                ),
              ],
            ),
      body: ParentStateView(
        controller: c,
        emptyTitle: 'p07_no_messages'.tr,
        emptyMessage: 'p07_no_messages_hint'.tr,
        emptyIcon: AppIcons.email,
        builder: () => ParentList(
          onRefresh: c.load,
          children: [
            if (c.messages.isEmpty)
              AppText('p07_no_messages'.tr, style: AppTypography.bodySmall)
            else
              for (final m in c.messages) ...[
                _Bubble(m: m, mine: m.senderUid == me),
                const SizedBox(height: AppDimens.s2),
              ],
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.m, required this.mine});

  final ThreadMessage m;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.85),
        child: AppCard(
          color: mine ? AppColors.brandSoft : AppColors.surface,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppText(mine ? 'p07_you'.tr : m.senderName, style: AppTypography.label),
              AppText(m.text, style: AppTypography.body),
              if (m.at != null) AppText(campusDateTime(m.at!), style: AppTypography.caption),
            ],
          ),
        ),
      ),
    );
  }
}

/// Start a conversation about the selected child.
class ParentThreadFormScreen extends StatefulWidget {
  const ParentThreadFormScreen({super.key});

  @override
  State<ParentThreadFormScreen> createState() => _ParentThreadFormScreenState();
}

class _ParentThreadFormScreenState extends State<ParentThreadFormScreen> with ParentFormState {
  late final ParentInboxController c = Get.isRegistered<ParentInboxController>()
      ? Get.find<ParentInboxController>()
      : Get.put(ParentInboxController());
  final subject = TextEditingController();
  final text = TextEditingController();

  @override
  bool get isDirty => subject.text.isNotEmpty || text.text.isNotEmpty;

  @override
  void dispose() {
    subject.dispose();
    text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final ok = setLocalErrors({
      if (subject.text.trim().length < 3) 'subject': 'error_required',
      if (text.text.trim().isEmpty) 'text': 'error_required',
    });
    if (!ok) return;
    await send(
      () => c.openThread(subject: subject.text.trim(), text: text.text.trim(), opId: opId),
      onDone: () => done('p07_thread_sent'),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      title: 'p07_new_thread'.tr,
      contextLabels: parentContextLabels(),
      footer: AppButton(
        label: 'p07_start'.tr,
        loadingLabel: 'state_sending'.tr,
        onPressed: _submit,
      ),
      children: [
        if (formError != null) ...[
          AppBanner(tone: AppTone.error, message: formError!),
          const SizedBox(height: AppDimens.s3),
        ],
        AppInput(
          label: 'p03_note_subject'.tr,
          controller: subject,
          required: true,
          maxLength: 200,
          error: fieldErrors['subject'],
        ),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 'p07_message'.tr,
          controller: text,
          kind: AppInputKind.multiline,
          required: true,
          maxLength: 4000,
          error: fieldErrors['text'],
        ),
      ],
    );
  }
}
