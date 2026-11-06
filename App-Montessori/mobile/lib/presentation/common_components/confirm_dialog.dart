import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../models/ui_models/app_tone.dart';
import '../../services/network/app_exception.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_banner.dart';
import 'app_button.dart';

/// Confirmation for sensitive actions (DESIGN_SYSTEM §11): the message must name
/// the OBJECT and the IMPACT, e.g. "Xác nhận trả Nguyễn Minh An cho bà Trần
/// Thị Hoa lúc 16:45?". If data needed to decide is missing, pass
/// [disabledReason]: the CTA is disabled and the reason is shown.
///
/// With [onConfirm] the dialog stays open with a loading CTA until the call
/// finishes, shows the server error inside the dialog on failure (input kept),
/// and only closes with `true` on success.
class ConfirmDialog extends StatefulWidget {
  const ConfirmDialog({
    super.key,
    required this.title,
    required this.message,
    required this.confirmLabel,
    this.cancelLabel,
    this.destructive = false,
    this.details,
    this.disabledReason,
    this.onConfirm,
  });

  final String title;
  final String message;
  final String confirmLabel;
  final String? cancelLabel;
  final bool destructive;

  /// Extra content (list of impacts, a text field for a mandatory reason...).
  final Widget? details;
  final String? disabledReason;
  final Future<void> Function()? onConfirm;

  /// Returns true when confirmed, false/null when cancelled.
  static Future<bool> show({
    required String title,
    required String message,
    required String confirmLabel,
    String? cancelLabel,
    bool destructive = false,
    Widget? details,
    String? disabledReason,
    Future<void> Function()? onConfirm,
  }) async {
    final r = await showDialog<bool>(
      context: Get.context!,
      barrierDismissible: onConfirm == null,
      builder: (_) => ConfirmDialog(
        title: title,
        message: message,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        destructive: destructive,
        details: details,
        disabledReason: disabledReason,
        onConfirm: onConfirm,
      ),
    );
    return r ?? false;
  }

  @override
  State<ConfirmDialog> createState() => _ConfirmDialogState();
}

class _ConfirmDialogState extends State<ConfirmDialog> {
  bool _busy = false;
  String? _error;

  Future<void> _confirm() async {
    if (widget.onConfirm == null) {
      Navigator.of(context).pop(true);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onConfirm!();
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      final msg = e is AppException ? e.userMessage : 'error_generic'.tr;
      if (mounted) {
        setState(() {
          _busy = false;
          _error = msg;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cancel = AppButton(
      label: widget.cancelLabel ?? 'action_cancel'.tr,
      variant: AppButtonVariant.secondary,
      onPressed: _busy ? null : () => Navigator.of(context).pop(false),
    );
    final confirm = AppButton(
      label: widget.confirmLabel,
      variant: widget.destructive ? AppButtonVariant.destructive : AppButtonVariant.primary,
      loading: _busy,
      onPressed: widget.disabledReason != null ? null : _confirm,
    );
    final scale = MediaQuery.textScalerOf(context).scale(16) / 16;

    return Dialog(
      insetPadding: const EdgeInsets.all(AppDimens.s6),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppDimens.dialogMaxWidth),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppDimens.s6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: AppText(widget.title, style: AppTypography.heading3),
              ),
              const SizedBox(height: AppDimens.s3),
              AppText(widget.message, style: AppTypography.body),
              if (widget.details != null) ...[
                const SizedBox(height: AppDimens.s3),
                widget.details!,
              ],
              if (widget.disabledReason != null) ...[
                const SizedBox(height: AppDimens.s3),
                AppBanner(message: widget.disabledReason!, tone: AppTone.warning),
              ],
              if (_error != null) ...[
                const SizedBox(height: AppDimens.s3),
                AppBanner(message: _error!, tone: AppTone.error),
              ],
              const SizedBox(height: AppDimens.s6),
              // Two buttons side by side; stacked when narrow or text is large.
              LayoutBuilder(
                builder: (context, c) {
                  final stack = c.maxWidth < 260 || scale > 1.3;
                  if (stack) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [confirm, const SizedBox(height: AppDimens.s3), cancel],
                    );
                  }
                  return Row(
                    children: [
                      Expanded(child: cancel),
                      const SizedBox(width: AppDimens.s3),
                      Expanded(child: confirm),
                    ],
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A short impact list for [ConfirmDialog.details]: bullet lines on a muted
/// surface ("Công nợ không đổi", "Phụ huynh nhận thông báo").
class ImpactList extends StatelessWidget {
  const ImpactList({super.key, required this.lines});

  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppDimens.s3),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppDimens.radiusMd),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 8, right: AppDimens.s2),
                    child: Icon(Icons.circle, size: 6, color: AppColors.textSecondary),
                  ),
                  Expanded(child: AppText(l, style: AppTypography.bodySmall)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
