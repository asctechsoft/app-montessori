import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/teacher_class_controller.dart';
import '../../controller/teacher_common.dart';
import '../../controller/teacher_inbox_controller.dart';
import '../../models/data_models/teacher_models.dart';
import '../../models/ui_models/app_tone.dart';
import '../../services/network/api_service.dart';
import '../../services/network/app_exception.dart';
import '../../utils/date_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import '../../values/route_teacher.dart';
import '../common_components/app_badge.dart';
import '../common_components/app_banner.dart';
import '../common_components/app_button.dart';
import '../common_components/app_card.dart';
import '../common_components/app_icons.dart';
import '../common_components/app_input.dart';
import '../common_components/bottom_sheet_base.dart';
import '../common_components/screen_scaffold.dart';
import 'teacher_widgets.dart';

/// T07: notifications (read / acknowledge) and message threads.
class TeacherInboxScreen extends StatefulWidget {
  const TeacherInboxScreen({super.key});

  @override
  State<TeacherInboxScreen> createState() => _TeacherInboxScreenState();
}

class _TeacherInboxScreenState extends State<TeacherInboxScreen> {
  late final TeacherInboxController c = teacherCtl(() => TeacherInboxController());
  int _seg = 0;

  Future<void> _open(NotificationItem n) async {
    try {
      await c.open(n);
    } catch (e) {
      teacherToast(toAppException(e).userMessage, tone: AppTone.error);
    }
  }

  Future<void> _newThread() => BottomSheetBase.show<void>(
    title: 't_thread_new'.tr,
    builder: (_) => _NewThreadForm(c: c),
  );

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final clock = teacherClock();
      return ScreenScaffold(
        title: 'screen_t07'.tr,
        contextLabels: teacherContext(),
        onRefresh: c.load,
        footer: _seg == 1
            ? AppButton(label: 't_thread_new'.tr, icon: Icons.add, size: AppButtonSize.lg, onPressed: _newThread)
            : null,
        children: [
          SegmentBar(
            labels: [
              't_inbox_notifications'.trParams({'args1': '${c.unreadCount}'}),
              't_inbox_threads'.tr,
            ],
            index: _seg,
            onChanged: (i) => setState(() => _seg = i),
          ),
          const SizedBox(height: AppDimens.s3),
          ...stateChildren(
            state: c.state.value,
            error: c.error.value,
            onRetry: c.load,
            staleSince: c.loadedAt.value,
            emptyTitle: 't_inbox_empty_title'.tr,
            emptyMessage: 't_inbox_empty_message'.tr,
            emptyIcon: AppIcons.bell,
            content: () => _seg == 0 ? _notifications(clock) : _threads(clock),
          ),
        ],
      );
    });
  }

  List<Widget> _notifications(CampusClock clock) {
    if (c.notifications.isEmpty) {
      return [AppBanner(message: 't_inbox_none_notifications'.tr, tone: AppTone.info)];
    }
    return [
      for (final n in c.notifications) ...[
        AppCard(
          onTap: () => _open(n),
          selected: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (n.unread) ...[
                    const Icon(Icons.circle, size: 10, color: AppColors.brand),
                    const SizedBox(width: AppDimens.s2),
                  ],
                  Expanded(child: AppText(n.title.isEmpty ? 'p07_notif_untitled'.tr : n.title, style: AppTypography.bodyStrong)),
                ],
              ),
              if (n.body.isNotEmpty) AppText(n.body, style: AppTypography.body),
              if (n.sentAt != null) AppText(clock.dateTime(n.sentAt!), style: AppTypography.caption),
              if (n.requireAck) ...[
                const SizedBox(height: AppDimens.s2),
                if (n.ackAt != null)
                  AppBadge(label: 't_inbox_acked'.tr, tone: AppTone.success)
                else
                  AppButton(
                    label: 't_inbox_ack'.tr,
                    size: AppButtonSize.sm,
                    expand: false,
                    onPressed: () async {
                      try {
                        await c.ack(n);
                      } catch (e) {
                        teacherToast(toAppException(e).userMessage, tone: AppTone.error);
                      }
                    },
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: AppDimens.s3),
      ],
    ];
  }

  List<Widget> _threads(CampusClock clock) {
    if (c.threads.isEmpty) {
      return [AppBanner(message: 't_inbox_none_threads'.tr, tone: AppTone.info)];
    }
    return [
      for (final t in c.threads) ...[
        AppCard(
          onTap: () => Get.toNamed<void>(RouteTeacher.thread, arguments: t),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AppText(t.subject, style: AppTypography.bodyStrong),
                    if (t.lastMessageAt != null)
                      AppText(clock.dateTime(t.lastMessageAt!), style: AppTypography.caption),
                  ],
                ),
              ),
              if (t.status == 'closed') AppBadge(label: 't_thread_closed'.tr, tone: AppTone.neutral),
              const Icon(AppIcons.chevronRight, color: AppColors.textSecondary),
            ],
          ),
        ),
        const SizedBox(height: AppDimens.s3),
      ],
    ];
  }
}


class _NewThreadForm extends StatefulWidget {
  const _NewThreadForm({required this.c});
  final TeacherInboxController c;

  @override
  State<_NewThreadForm> createState() => _NewThreadFormState();
}

class _NewThreadFormState extends State<_NewThreadForm> {
  final _subject = TextEditingController();
  final _text = TextEditingController();
  FormErrors _err = FormErrors();
  String? _opId;

  @override
  void dispose() {
    _subject.dispose();
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final cls = teacherCtl(() => TeacherClassController());
    final classId = cls.classId.value;
    if (classId == null) {
      setState(() => _err = FormErrors({}, 't_thread_no_class'.tr));
      return;
    }
    _opId ??= ApiService.newOpId();
    try {
      await widget.c.openThread(
        subject: _subject.text.trim(),
        text: _text.text.trim(),
        classId: classId,
        opId: _opId,
      );
      _opId = null;
      if (!mounted) return;
      Navigator.of(context).pop();
      teacherToast('t_thread_created'.tr);
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) _opId = null;
      if (mounted) setState(() => _err = FormErrors.from(ex));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_err.general != null) ...[ErrorBanner(_err.general!), const SizedBox(height: AppDimens.s3)],
        AppInput(label: 't_thread_subject'.tr, controller: _subject, required: true, error: _err.of('subject')),
        const SizedBox(height: AppDimens.s3),
        AppInput(
          label: 't_thread_message'.tr,
          controller: _text,
          kind: AppInputKind.multiline,
          error: _err.of('text'),
        ),
        const SizedBox(height: AppDimens.s4),
        AppButton(label: 't_thread_create'.tr, loadingLabel: 'state_sending'.tr, onPressed: _send),
      ],
    );
  }
}

class TeacherThreadScreen extends StatefulWidget {
  const TeacherThreadScreen({super.key, required this.thread});
  final ThreadItem thread;

  @override
  State<TeacherThreadScreen> createState() => _TeacherThreadScreenState();
}

class _TeacherThreadScreenState extends State<TeacherThreadScreen> {
  late final TeacherInboxController c = teacherCtl(() => TeacherInboxController());
  final _text = TextEditingController();
  List<MessageItem> _msgs = const [];
  bool _loading = true;
  AppException? _error;
  String? _opId;
  FormErrors _err = FormErrors();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final m = await c.messages(widget.thread.id);
      if (mounted) setState(() => _msgs = m);
    } catch (e) {
      if (mounted) setState(() => _error = toAppException(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final t = _text.text.trim();
    if (t.isEmpty) return;
    _opId ??= ApiService.newOpId();
    try {
      await c.post(widget.thread.id, t, opId: _opId);
      _opId = null;
      _text.clear();
      _err = FormErrors();
      await _load();
    } catch (e) {
      final ex = toAppException(e);
      if (!ex.isNetwork) _opId = null;
      // The typed text stays in the box.
      if (mounted) setState(() => _err = FormErrors.from(ex));
    }
  }

  @override
  Widget build(BuildContext context) {
    final clock = teacherClock();
    final closed = widget.thread.status == 'closed';
    return ScreenScaffold(
      title: widget.thread.subject,
      contextLabels: teacherContext(),
      onRefresh: _load,
      footer: closed
          ? AppText('t_thread_closed_note'.tr, style: AppTypography.bodySmall)
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_err.general != null) ...[ErrorBanner(_err.general!), const SizedBox(height: AppDimens.s2)],
                AppInput(label: 't_thread_message'.tr, controller: _text, kind: AppInputKind.multiline),
                const SizedBox(height: AppDimens.s2),
                AppButton(label: 't_thread_send'.tr, loadingLabel: 'state_sending'.tr, onPressed: _send),
              ],
            ),
      children: [
        if (_loading)
          const SizedBox(height: 120, child: Center(child: CircularProgressIndicator()))
        else if (_error != null)
          AppBanner(
            tone: AppTone.error,
            message: _error!.userMessage,
            actionLabel: 'action_retry'.tr,
            onAction: _load,
          )
        else if (_msgs.isEmpty)
          AppText('t_thread_empty'.tr, style: AppTypography.bodySmall)
        else
          for (final m in _msgs) ...[
            Align(
              alignment: m.senderUid == c.myUid ? Alignment.centerRight : Alignment.centerLeft,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
                child: Container(
                  padding: const EdgeInsets.all(AppDimens.s3),
                  decoration: BoxDecoration(
                    color: m.senderUid == c.myUid ? AppColors.brandSoft : AppColors.surface,
                    borderRadius: BorderRadius.circular(AppDimens.radiusMd),
                    border: Border.all(color: AppColors.borderSubtle),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppText(m.senderName, style: AppTypography.caption),
                      AppText(m.text, style: AppTypography.body),
                      if (m.at != null) AppText(clock.dateTime(m.at!), style: AppTypography.caption),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: AppDimens.s2),
          ],
      ],
    );
  }
}
