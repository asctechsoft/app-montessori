import 'package:flutter/widgets.dart';

/// Spacing, radius and size tokens (tokens.json `space`, `radius`, `size`).
/// Logical px; grid 4.
class AppDimens {
  AppDimens._();

  // space
  static const double s0 = 0;
  static const double s1 = 4;
  static const double s2 = 8;
  static const double s3 = 12;
  static const double s4 = 16;
  static const double s5 = 20;
  static const double s6 = 24;
  static const double s8 = 32;
  static const double s10 = 40;
  static const double s12 = 48;
  static const double s16 = 64;

  // radius
  static const double radiusXs = 4;
  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 16;
  static const double radiusXl = 24;
  static const double radiusPill = 999;

  // sizes
  static const double buttonSm = 40;
  static const double buttonMd = 48;
  static const double buttonLg = 56;
  static const double touchMin = 48;
  static const double inputMin = 52;
  static const double textareaMin = 120;
  static const double appBarMin = 56;
  static const double bottomNavMin = 64;
  static const double iconSm = 16;
  static const double iconMd = 20;
  static const double iconLg = 24;
  static const double avatarSm = 32;
  static const double avatarMd = 40;
  static const double avatarLg = 56;
  static const double avatarXl = 80;
  static const double pagePadding = 24;
  static const double pagePaddingCompact = 16;
  static const double cardPadding = 16;
  static const double rowMin = 64;
  static const double badgeMin = 24;

  // stroke
  static const double hairline = 1;
  static const double focusStroke = 2;
  static const double iconStroke = 1.75;

  // motion
  static const Duration pressMs = Duration(milliseconds: 100);
  static const Duration fadeMs = Duration(milliseconds: 150);
  static const Duration sheetMs = Duration(milliseconds: 240);

  // layout
  static const double referenceWidth = 390;
  static const double compactWidth = 360;
  static const double maxContentWidth = 600;
  static const double dialogMaxWidth = 344;

  /// Page side padding: 24, or 16 on screens narrower than 360.
  static double pageGutter(BuildContext context) =>
      MediaQuery.sizeOf(context).width < compactWidth
      ? pagePaddingCompact
      : pagePadding;
}
