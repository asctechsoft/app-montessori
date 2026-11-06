import 'package:asc_common/asc_common.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';
import '../../values/app_typography.dart';

/// Avatar 32/40/56/80. Without a photo it shows the person's INITIALS; it never
/// falls back to another child's picture (DESIGN_SYSTEM §13). Photos of
/// children have no public URL: pass a short-lived download URL only.
class AppAvatar extends StatelessWidget {
  const AppAvatar({
    super.key,
    required this.name,
    this.imageUrl,
    this.size = AppDimens.avatarMd,
    this.semanticLabel,
  });

  final String name;
  final String? imageUrl;
  final double size;
  final String? semanticLabel;

  /// "Nguyễn Minh An" -> "NA" (first letter of first and last word); one word
  /// -> that letter; empty -> "?".
  static String initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    String first(String s) => String.fromCharCode(s.runes.first).toUpperCase();
    if (parts.length == 1) return first(parts.first);
    return first(parts.first) + first(parts.last);
  }

  @override
  Widget build(BuildContext context) {
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: AppColors.brandSoft,
        shape: BoxShape.circle,
      ),
      child: AppText(
        initials(name),
        style: (size >= AppDimens.avatarLg ? AppTypography.title : AppTypography.label)
            .copyWith(color: AppColors.action),
      ),
    );
    final url = imageUrl;
    return Semantics(
      label: semanticLabel ?? name,
      image: true,
      excludeSemantics: true,
      child: SizedBox(
        width: size,
        height: size,
        child: url == null || url.isEmpty
            ? fallback
            : ClipOval(
                child: CachedNetworkImage(
                  imageUrl: url,
                  width: size,
                  height: size,
                  fit: BoxFit.cover,
                  placeholder: (_, _) => fallback,
                  errorWidget: (_, _, _) => fallback,
                ),
              ),
      ),
    );
  }
}
