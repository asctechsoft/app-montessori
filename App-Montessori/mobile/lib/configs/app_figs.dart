import 'package:asc_common/asc_common.dart';

/// Build-flavor flags: thin alias over [AscBuildFlavor].
/// Flavor names match `--flavor` in `android/app/build.gradle.kts`
/// (`alpha`, `dev`, `product`, `claude`). Never read `appFlavor` directly.
class AppFigs {
  AppFigs._();

  static const bool isAlpha = AscBuildFlavor.isAlpha;
  static const bool isDev = AscBuildFlavor.isDev;
  static const bool isProduct = AscBuildFlavor.isProduct;
  static const bool isClaude = AscBuildFlavor.isClaude;

  /// Debug-only affordances (dev logging, catalog screen, boot step names):
  /// everywhere except a shipped Product build.
  static const bool isShowTestOption = AscBuildFlavor.isShowTestOption;
}
