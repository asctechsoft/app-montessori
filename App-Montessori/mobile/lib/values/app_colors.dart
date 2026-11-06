import 'package:flutter/painting.dart';

/// Colour tokens, 1:1 with `MamNon_App_Design_System/tokens.json` (light mode
/// only). Screens and components name a token by role; never write a hex value
/// anywhere else.
class AppColors {
  AppColors._();

  // Brand and action
  static const Color brand = Color(0xFF168579);
  static const Color action = Color(0xFF11776D);
  static const Color actionPressed = Color(0xFF0D5E56);
  static const Color brandSoft = Color(0xFFE7F4F0);

  // Surfaces
  static const Color background = Color(0xFFF7F9F8);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceMuted = Color(0xFFEFF4F2);
  static const Color surfaceRaised = Color(0xFFFFFFFF);

  // Text
  static const Color textPrimary = Color(0xFF172D34);
  static const Color textSecondary = Color(0xFF52666E);
  static const Color textTertiary = Color(0xFF667980);
  static const Color textOnAction = Color(0xFFFFFFFF);
  static const Color textDisabled = Color(0xFF667980);

  // Borders
  static const Color borderSubtle = Color(0xFFDCE5E3);
  static const Color borderControl = Color(0xFF738C88);
  static const Color borderFocus = Color(0xFF168579);
  static const Color divider = Color(0xFFE5ECEA);

  // Semantic
  static const Color success = Color(0xFF287246);
  static const Color successSoft = Color(0xFFEAF5ED);
  static const Color warning = Color(0xFF916000);
  static const Color warningSoft = Color(0xFFFFF4D9);
  static const Color error = Color(0xFFC13F36);
  static const Color errorSoft = Color(0xFFFDEEEB);
  static const Color info = Color(0xFF22669D);
  static const Color infoSoft = Color(0xFFEDF4FB);

  static const Color disabledFill = Color(0xFFE7ECEA);
  static const Color overlay = Color(0x8F172D34);

  // Elevation shadows
  static const Color shadowFloating = Color(0x14172D34);
  static const Color shadowModal = Color(0x29172D34);
}
