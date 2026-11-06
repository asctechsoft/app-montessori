import 'dart:async';

import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';

enum AppButtonVariant { primary, secondary, tertiary, destructive, destructiveOutline }

enum AppButtonSize { sm, md, lg }

/// Button of the design system (DESIGN_SYSTEM §6).
///
/// * `onPressed == null` renders Disabled (disabledFill + textDisabled).
/// * While [loading] (or while an async [onPressed] is still running) the
///   spinner replaces the icon, the label and width stay, and further taps are
///   ignored: no double submit. Loading is a technical state, never "approved".
/// * Visual height is 40/48/56, but the hit area is always >= 48.
/// * Long Vietnamese labels wrap (max 2 lines) and grow the button instead of
///   shrinking the text.
class AppButton extends StatefulWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.size = AppButtonSize.md,
    this.icon,
    this.loading = false,
    this.loadingLabel,
    this.expand = true,
    this.semanticLabel,
  });

  final String label;

  /// May return a Future: the button then shows loading until it completes.
  final FutureOr<void> Function()? onPressed;
  final AppButtonVariant variant;
  final AppButtonSize size;
  final IconData? icon;
  final bool loading;

  /// Text while loading (e.g. "Đang gửi"); defaults to [label].
  final String? loadingLabel;

  /// Full width (default, for bottom CTAs). Use false for inline buttons.
  final bool expand;
  final String? semanticLabel;

  @override
  State<AppButton> createState() => _AppButtonState();
}

class _AppButtonState extends State<AppButton> {
  bool _busy = false;

  bool get _loading => widget.loading || _busy;
  bool get _enabled => widget.onPressed != null && !_loading;

  Future<void> _tap() async {
    if (!_enabled) return;
    final result = widget.onPressed!.call();
    if (result is Future) {
      setState(() => _busy = true);
      try {
        await result;
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    }
  }

  double get _height => switch (widget.size) {
    AppButtonSize.sm => AppDimens.buttonSm,
    AppButtonSize.md => AppDimens.buttonMd,
    AppButtonSize.lg => AppDimens.buttonLg,
  };

  double get _hPad => switch (widget.size) {
    AppButtonSize.sm => 12,
    AppButtonSize.md => 16,
    AppButtonSize.lg => 20,
  };

  double get _iconSize =>
      widget.size == AppButtonSize.sm ? AppDimens.iconSm : AppDimens.iconMd;

  @override
  Widget build(BuildContext context) {
    final v = widget.variant;
    final enabled = widget.onPressed != null; // loading keeps normal colours
    Color bg;
    Color fg;
    BorderSide? border;
    switch (v) {
      case AppButtonVariant.primary:
        bg = AppColors.action;
        fg = AppColors.textOnAction;
      case AppButtonVariant.secondary:
        bg = AppColors.surface;
        fg = AppColors.action;
        border = const BorderSide(color: AppColors.action);
      case AppButtonVariant.tertiary:
        bg = Colors.transparent;
        fg = AppColors.action;
      case AppButtonVariant.destructive:
        bg = AppColors.error;
        fg = AppColors.textOnAction;
      case AppButtonVariant.destructiveOutline:
        bg = AppColors.surface;
        fg = AppColors.error;
        border = const BorderSide(color: AppColors.error);
    }
    if (!enabled) {
      bg = v == AppButtonVariant.tertiary ? Colors.transparent : AppColors.disabledFill;
      fg = AppColors.textDisabled;
      border = null;
    }

    final textStyle = (widget.size == AppButtonSize.sm
            ? AppTypography.label
            : AppTypography.button)
        .copyWith(color: fg);

    final isFilled = v == AppButtonVariant.primary || v == AppButtonVariant.destructive;
    final Color pressed = isFilled
        ? (v == AppButtonVariant.primary
              ? AppColors.actionPressed
              : AppColors.error)
        : AppColors.brandSoft;

    final content = Row(
      mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (_loading) ...[
          SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2, color: fg),
          ),
          const SizedBox(width: AppDimens.s2),
        ] else if (widget.icon != null) ...[
          Icon(widget.icon, size: _iconSize, color: fg),
          const SizedBox(width: AppDimens.s2),
        ],
        Flexible(
          child: AppText(
            _loading ? (widget.loadingLabel ?? widget.label) : widget.label,
            style: textStyle,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );

    final visual = Container(
      constraints: BoxConstraints(minHeight: _height),
      padding: EdgeInsets.symmetric(horizontal: _hPad, vertical: AppDimens.s2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppDimens.radiusMd),
        border: border == null ? null : Border.fromBorderSide(border),
      ),
      alignment: Alignment.center,
      child: content,
    );

    final touchable = AppTouchable(
      onTap: _enabled ? _tap : null,
      borderRadius: BorderRadius.circular(AppDimens.radiusMd),
      pressedScale: 1,
      splashColor: pressed.withValues(alpha: isFilled ? 0.35 : 0.6),
      highlightColor: pressed.withValues(alpha: isFilled ? 0.35 : 0.6),
      child: visual,
    );

    // Hit area >= 48 even for the 40-high small button.
    final sized = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: AppDimens.touchMin),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _enabled ? _tap : null,
        child: Align(
          alignment: Alignment.center,
          widthFactor: widget.expand ? null : 1,
          child: touchable,
        ),
      ),
    );

    return Semantics(
      button: true,
      enabled: widget.onPressed != null && !_loading,
      label: _loading
          ? '${widget.semanticLabel ?? widget.label}, ${'state_loading'.tr}'
          : (widget.semanticLabel ?? widget.label),
      excludeSemantics: true,
      onTap: _enabled ? _tap : null,
      child: sized,
    );
  }
}
