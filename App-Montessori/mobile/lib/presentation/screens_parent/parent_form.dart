import 'package:flutter/widgets.dart';
import 'package:get/get.dart';

import '../../controller/session_controller.dart';
import '../../services/network/api_service.dart';
import '../../services/network/app_exception.dart';
import '../../utils/toast_utils.dart';

/// State helper of the parent forms:
///
/// * [opId] is created ONCE per intent and reused when the user retries after
///   a network error (the server de-duplicates), and renewed only after a
///   confirmed success or when the user edits the content ([renewOp]).
/// * Server `fieldErrors` map onto the inputs; other errors show in a banner;
///   nothing typed is ever cleared on failure.
/// * The form registers as "unsaved" while [isDirty] so switching child asks first.
mixin ParentFormState<T extends StatefulWidget> on State<T> {
  String opId = ApiService.newOpId();
  Map<String, String> fieldErrors = {};
  String? formError;
  void Function()? _unregister;

  bool get isDirty;

  @override
  void initState() {
    super.initState();
    _unregister = SessionController.to.registerDirtyGuard(() => isDirty);
  }

  @override
  void dispose() {
    _unregister?.call();
    super.dispose();
  }

  void renewOp() => opId = ApiService.newOpId();

  /// Local validation result (field -> message key); non-empty blocks sending.
  bool setLocalErrors(Map<String, String> keys) {
    setState(() {
      fieldErrors = {for (final e in keys.entries) e.key: e.value.tr};
      formError = null;
    });
    return keys.isEmpty;
  }

  /// Runs [action]; on success calls [onDone] (toast + pop).
  Future<void> send(Future<void> Function() action, {required VoidCallback onDone}) async {
    setState(() {
      formError = null;
      fieldErrors = {};
    });
    try {
      await action();
    } catch (e) {
      final ex = e is AppException ? e : ApiService.normalizeError(e);
      if (!mounted) return;
      setState(() {
        fieldErrors = Map.of(ex.fieldErrors);
        formError = ex.fieldErrors.isEmpty ? _messageFor(ex) : 'form_fix_fields'.tr;
      });
      return;
    }
    renewOp();
    onDone();
  }

  String _messageFor(AppException ex) => ex.isForbidden ? 'form_forbidden'.tr : ex.userMessage;

  void done(String messageKey) {
    AppToast.success(messageKey.tr);
    if (mounted) Navigator.of(context).maybePop();
  }
}
