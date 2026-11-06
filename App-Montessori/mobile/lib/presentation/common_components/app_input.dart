import 'package:asc_common/asc_common.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';

import '../../utils/date_formatter.dart';
import '../../utils/money_formatter.dart';
import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';
import 'app_icons.dart';

enum AppInputKind {
  text,
  multiline,
  email,
  phone,
  password,
  number,

  /// Read-only field that opens a date picker; shows `dd/MM/yyyy`.
  date,

  /// Read-only field that opens a time picker; shows `HH:mm` (24h).
  time,

  /// Integer VND with `.` thousand separators; use [AppInput.onAmountChanged].
  money,
}

/// Formats digits as `4.100.000` while typing (cursor stays at the end).
class MoneyInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final amount = MoneyFormatter.parse(newValue.text);
    if (amount == null) return const TextEditingValue();
    final text = MoneyFormatter.digits(amount.abs());
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

/// Text field of the design system (DESIGN_SYSTEM §7): label OUTSIDE the box,
/// helper or error below, min height 52, radius 12, border 1 (focus/error 2).
/// Read-only (selectable, explained) is different from disabled.
///
/// Date/time/money kinds keep the value typed (DateTime / TimeOfDay / int) apart
/// from the display string.
class AppInput extends StatefulWidget {
  const AppInput({
    super.key,
    required this.label,
    this.controller,
    this.initialValue,
    this.hint,
    this.helper,
    this.error,
    this.required = false,
    this.readOnly = false,
    this.disabled = false,
    this.kind = AppInputKind.text,
    this.onChanged,
    this.onSubmitted,
    this.textInputAction,
    this.focusNode,
    this.maxLength,
    this.autofillHints,
    this.prefixIcon,
    this.suffix,
    this.dateValue,
    this.firstDate,
    this.lastDate,
    this.onDatePicked,
    this.timeValue,
    this.onTimePicked,
    this.amount,
    this.onAmountChanged,
    this.autofocus = false,
  });

  final String label;
  final TextEditingController? controller;
  final String? initialValue;
  final String? hint;
  final String? helper;

  /// Error text shown under the field with an icon (also announced).
  final String? error;
  final bool required;
  final bool readOnly;
  final bool disabled;
  final AppInputKind kind;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? textInputAction;
  final FocusNode? focusNode;
  final int? maxLength;
  final Iterable<String>? autofillHints;
  final IconData? prefixIcon;
  final Widget? suffix;
  final bool autofocus;

  // date
  final DateTime? dateValue;
  final DateTime? firstDate;
  final DateTime? lastDate;
  final ValueChanged<DateTime>? onDatePicked;

  // time
  final TimeOfDay? timeValue;
  final ValueChanged<TimeOfDay>? onTimePicked;

  // money
  final int? amount;
  final ValueChanged<int?>? onAmountChanged;

  @override
  State<AppInput> createState() => _AppInputState();
}

class _AppInputState extends State<AppInput> {
  late final TextEditingController _controller;
  late final bool _ownsController;
  late final FocusNode _focus;
  late final bool _ownsFocus;
  bool _obscure = true;
  bool _hasFocus = false;

  bool get _isPicker =>
      widget.kind == AppInputKind.date || widget.kind == AppInputKind.time;

  @override
  void initState() {
    super.initState();
    _ownsController = widget.controller == null;
    _controller = widget.controller ?? TextEditingController();
    if (_ownsController) _controller.text = _initialText();
    _ownsFocus = widget.focusNode == null;
    _focus = widget.focusNode ?? FocusNode();
    _focus.addListener(_onFocus);
    _syncTyped();
  }

  String _initialText() {
    switch (widget.kind) {
      case AppInputKind.date:
        return widget.dateValue == null ? '' : DateFormatter.date(widget.dateValue!);
      case AppInputKind.time:
        return widget.timeValue == null
            ? ''
            : '${widget.timeValue!.hour.toString().padLeft(2, '0')}:'
                '${widget.timeValue!.minute.toString().padLeft(2, '0')}';
      case AppInputKind.money:
        return widget.amount == null ? '' : MoneyFormatter.digits(widget.amount!);
      default:
        return widget.initialValue ?? '';
    }
  }

  void _syncTyped() {
    if (widget.kind == AppInputKind.date || widget.kind == AppInputKind.time ||
        widget.kind == AppInputKind.money) {
      final t = _initialText();
      if (_controller.text != t && !(_focus.hasFocus && widget.kind == AppInputKind.money)) {
        _controller.text = t;
      }
    }
  }

  @override
  void didUpdateWidget(covariant AppInput old) {
    super.didUpdateWidget(old);
    if (old.dateValue != widget.dateValue ||
        old.timeValue != widget.timeValue ||
        old.amount != widget.amount) {
      _syncTyped();
    }
  }

  void _onFocus() {
    if (mounted) setState(() => _hasFocus = _focus.hasFocus);
  }

  @override
  void dispose() {
    _focus.removeListener(_onFocus);
    if (_ownsFocus) _focus.dispose();
    if (_ownsController) _controller.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    if (widget.readOnly || widget.disabled) return;
    if (widget.kind == AppInputKind.date) {
      final now = DateTime.now();
      final picked = await showDatePicker(
        context: context,
        initialDate: widget.dateValue ?? now,
        firstDate: widget.firstDate ?? DateTime(now.year - 5),
        lastDate: widget.lastDate ?? DateTime(now.year + 5),
      );
      if (picked != null) widget.onDatePicked?.call(picked);
    } else {
      final picked = await showTimePicker(
        context: context,
        initialTime: widget.timeValue ?? TimeOfDay.now(),
        builder: (ctx, child) => MediaQuery(
          data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true),
          child: child!,
        ),
      );
      if (picked != null) widget.onTimePicked?.call(picked);
    }
  }

  TextInputType get _keyboard => switch (widget.kind) {
    AppInputKind.email => TextInputType.emailAddress,
    AppInputKind.phone => TextInputType.phone,
    AppInputKind.number || AppInputKind.money => TextInputType.number,
    AppInputKind.multiline => TextInputType.multiline,
    AppInputKind.password => TextInputType.visiblePassword,
    _ => TextInputType.text,
  };

  List<TextInputFormatter> get _formatters => switch (widget.kind) {
    AppInputKind.money => [MoneyInputFormatter()],
    // Phone keeps the leading 0 (a String, never a number).
    AppInputKind.phone => [FilteringTextInputFormatter.allow(RegExp(r'[0-9+\s.\-]'))],
    AppInputKind.number => [FilteringTextInputFormatter.digitsOnly],
    _ => const [],
  };

  @override
  Widget build(BuildContext context) {
    final hasError = widget.error != null && widget.error!.isNotEmpty;
    final disabled = widget.disabled;
    final readOnly = widget.readOnly || _isPicker;

    OutlineInputBorder border(Color c, double w) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppDimens.radiusMd),
      borderSide: BorderSide(color: c, width: w),
    );

    final Color idle = disabled ? AppColors.borderSubtle : AppColors.borderControl;

    Widget? suffix = widget.suffix;
    if (widget.kind == AppInputKind.password) {
      suffix = IconButton(
        tooltip: _obscure ? 'password_show'.tr : 'password_hide'.tr,
        constraints: const BoxConstraints(
          minWidth: AppDimens.touchMin,
          minHeight: AppDimens.touchMin,
        ),
        icon: Icon(
          _obscure ? AppIcons.visibility : AppIcons.visibilityOff,
          color: AppColors.textSecondary,
        ),
        onPressed: () => setState(() => _obscure = !_obscure),
      );
    } else if (widget.kind == AppInputKind.date) {
      suffix = const Icon(AppIcons.calendar, size: AppDimens.iconMd, color: AppColors.textSecondary);
    } else if (widget.kind == AppInputKind.time) {
      suffix = const Icon(Icons.schedule, size: AppDimens.iconMd, color: AppColors.textSecondary);
    }
    if (widget.kind == AppInputKind.money && suffix == null) {
      suffix = Padding(
        padding: const EdgeInsets.only(right: AppDimens.s4),
        child: AppText(
          MoneyFormatter.unit,
          style: AppTypography.body.copyWith(color: AppColors.textSecondary),
        ),
      );
    }

    final field = TextField(
      controller: _controller,
      focusNode: _focus,
      enabled: !disabled,
      readOnly: readOnly,
      showCursor: !_isPicker,
      autofocus: widget.autofocus,
      obscureText: widget.kind == AppInputKind.password && _obscure,
      enableSuggestions: widget.kind != AppInputKind.password,
      autocorrect: widget.kind != AppInputKind.password &&
          widget.kind != AppInputKind.email,
      keyboardType: _keyboard,
      textInputAction: widget.textInputAction,
      inputFormatters: _formatters,
      autofillHints: widget.autofillHints,
      maxLength: widget.maxLength,
      minLines: widget.kind == AppInputKind.multiline ? 4 : 1,
      maxLines: widget.kind == AppInputKind.multiline ? null : 1,
      style: AppTypography.body.copyWith(
        color: disabled ? AppColors.textDisabled : AppColors.textPrimary,
      ),
      onTap: _isPicker ? _pick : null,
      onChanged: (v) {
        widget.onChanged?.call(v);
        if (widget.kind == AppInputKind.money) {
          widget.onAmountChanged?.call(MoneyFormatter.parse(v));
        }
      },
      onSubmitted: widget.onSubmitted,
      decoration: InputDecoration(
        isDense: false,
        counterText: '',
        hintText: widget.hint,
        hintStyle: AppTypography.body.copyWith(color: AppColors.textTertiary),
        filled: true,
        fillColor: disabled
            ? AppColors.disabledFill
            : (widget.readOnly ? AppColors.surfaceMuted : AppColors.surface),
        constraints: const BoxConstraints(minHeight: AppDimens.inputMin),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppDimens.s4,
          vertical: AppDimens.s3,
        ),
        prefixIcon: widget.prefixIcon == null
            ? null
            : Icon(widget.prefixIcon, size: AppDimens.iconMd, color: AppColors.textSecondary),
        suffixIcon: suffix,
        border: border(idle, 1),
        enabledBorder: border(hasError ? AppColors.error : idle, hasError ? 2 : 1),
        focusedBorder: border(hasError ? AppColors.error : AppColors.borderFocus, 2),
        disabledBorder: border(idle, 1),
        errorBorder: border(AppColors.error, 2),
      ),
    );

    return Semantics(
      label: widget.required ? '${widget.label}, ${'field_required'.tr}' : widget.label,
      textField: true,
      readOnly: readOnly,
      enabled: !disabled,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          ExcludeSemantics(
            child: Padding(
              padding: const EdgeInsets.only(bottom: AppDimens.s2),
              child: Text.rich(
                TextSpan(
                  text: widget.label,
                  style: AppTypography.label.copyWith(
                    color: _hasFocus && !hasError
                        ? AppColors.action
                        : AppColors.textPrimary,
                  ),
                  children: [
                    if (widget.required)
                      TextSpan(
                        text: ' *',
                        style: AppTypography.label.copyWith(color: AppColors.error),
                      ),
                  ],
                ),
              ),
            ),
          ),
          field,
          if (hasError)
            Padding(
              padding: const EdgeInsets.only(top: AppDimens.s1),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 3),
                    child: Icon(AppIcons.error, size: AppDimens.iconSm, color: AppColors.error),
                  ),
                  const SizedBox(width: AppDimens.s1),
                  Expanded(
                    child: Semantics(
                      liveRegion: true,
                      child: AppText(
                        widget.error!,
                        style: AppTypography.bodySmall.copyWith(color: AppColors.error),
                      ),
                    ),
                  ),
                ],
              ),
            )
          else if (widget.helper != null && widget.helper!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: AppDimens.s1),
              child: AppText(widget.helper!, style: AppTypography.bodySmall),
            ),
        ],
      ),
    );
  }
}

/// OTP: 6 boxes shown, but ONE text field underneath (pastable, autofill
/// `oneTimeCode`), as DESIGN_SYSTEM §7 asks.
class AppOtpInput extends StatefulWidget {
  const AppOtpInput({
    super.key,
    required this.label,
    this.length = 6,
    this.error,
    this.helper,
    this.onChanged,
    this.onCompleted,
    this.autofocus = false,
  });

  final String label;
  final int length;
  final String? error;
  final String? helper;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onCompleted;
  final bool autofocus;

  @override
  State<AppOtpInput> createState() => _AppOtpInputState();
}

class _AppOtpInputState extends State<AppOtpInput> {
  final TextEditingController _c = TextEditingController();
  final FocusNode _f = FocusNode();

  @override
  void initState() {
    super.initState();
    _f.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _c.dispose();
    _f.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hasError = widget.error != null && widget.error!.isNotEmpty;
    final text = _c.text;
    return Semantics(
      label: widget.label,
      textField: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ExcludeSemantics(
            child: Padding(
              padding: const EdgeInsets.only(bottom: AppDimens.s2),
              child: AppText(widget.label, style: AppTypography.label),
            ),
          ),
          Stack(
            children: [
              ExcludeSemantics(
                child: Row(
                  children: List.generate(widget.length, (i) {
                    final active = _f.hasFocus && i == text.length.clamp(0, widget.length - 1);
                    return Expanded(
                      child: Padding(
                        padding: EdgeInsets.only(
                          right: i == widget.length - 1 ? 0 : AppDimens.s2,
                        ),
                        child: Container(
                          constraints: const BoxConstraints(minHeight: AppDimens.inputMin),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(AppDimens.radiusMd),
                            border: Border.all(
                              color: hasError
                                  ? AppColors.error
                                  : (active ? AppColors.borderFocus : AppColors.borderControl),
                              width: hasError || active ? 2 : 1,
                            ),
                          ),
                          child: AppText(
                            i < text.length ? text[i] : '',
                            style: AppTypography.title,
                          ),
                        ),
                      ),
                    );
                  }),
                ),
              ),
              Positioned.fill(
                child: Opacity(
                  opacity: 0,
                  child: TextField(
                    controller: _c,
                    focusNode: _f,
                    autofocus: widget.autofocus,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    maxLength: widget.length,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(counterText: ''),
                    onChanged: (v) {
                      setState(() {});
                      widget.onChanged?.call(v);
                      if (v.length == widget.length) widget.onCompleted?.call(v);
                    },
                  ),
                ),
              ),
            ],
          ),
          if (hasError)
            Padding(
              padding: const EdgeInsets.only(top: AppDimens.s1),
              child: Row(
                children: [
                  const Icon(AppIcons.error, size: AppDimens.iconSm, color: AppColors.error),
                  const SizedBox(width: AppDimens.s1),
                  Expanded(
                    child: AppText(
                      widget.error!,
                      style: AppTypography.bodySmall.copyWith(color: AppColors.error),
                    ),
                  ),
                ],
              ),
            )
          else if (widget.helper != null)
            Padding(
              padding: const EdgeInsets.only(top: AppDimens.s1),
              child: AppText(widget.helper!, style: AppTypography.bodySmall),
            ),
        ],
      ),
    );
  }
}
