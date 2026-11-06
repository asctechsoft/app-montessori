import 'package:flutter/widgets.dart';
import 'package:get/get.dart';

import '../services/network/app_exception.dart';
import '../utils/validators.dart';
import 'auth_controller.dart';

/// Form state of the email/password sign-in screen (route-scoped).
///
/// Errors: field errors under the field, general/network errors in a banner at
/// the top; the typed values are kept after a failure.
class LoginController extends GetxController {
  final TextEditingController email = TextEditingController();
  final TextEditingController password = TextEditingController();

  final RxnString emailError = RxnString();
  final RxnString passwordError = RxnString();
  final Rxn<AppException> formError = Rxn<AppException>();
  final RxBool submitted = false.obs;

  @override
  void onInit() {
    super.onInit();
    email.text = AuthController.to.lastEmail;
  }

  @override
  void onClose() {
    email.dispose();
    password.dispose();
    super.onClose();
  }

  bool _validate() {
    emailError.value = Validators.email(email.text);
    passwordError.value = Validators.required(password.text);
    return emailError.value == null && passwordError.value == null;
  }

  /// Re-validate a field after the first submit, as the user fixes it.
  void onFieldChanged() {
    formError.value = null;
    if (submitted.value) _validate();
  }

  /// Returns the route to open, or null when sign-in failed (error is set).
  Future<String?> submit() async {
    submitted.value = true;
    formError.value = null;
    if (!_validate()) return null;
    try {
      await AuthController.to.signInWithEmail(email.text, password.text);
      return await AuthController.to.routeAfterSession();
    } on AppException catch (e) {
      if (e.fieldErrors.containsKey('email')) {
        emailError.value = e.fieldErrors['email'];
      } else {
        formError.value = e;
      }
      return null;
    }
  }
}
