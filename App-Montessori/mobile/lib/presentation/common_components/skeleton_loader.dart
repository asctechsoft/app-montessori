import 'package:flutter/material.dart';

import '../../values/app_colors.dart';
import '../../values/app_dimensions.dart';

/// Grey placeholder block that pulses softly while data loads. With "reduce
/// motion" it is static (DESIGN_SYSTEM §13). Build skeletons in the layout of
/// the real content so the screen does not jump (§12: no endless full-screen
/// spinner).
class SkeletonBox extends StatefulWidget {
  const SkeletonBox({
    super.key,
    this.width,
    this.height = 16,
    this.radius = AppDimens.radiusSm,
    this.circle = false,
  });

  final double? width;
  final double height;
  final double radius;
  final bool circle;

  @override
  State<SkeletonBox> createState() => _SkeletonBoxState();
}

class _SkeletonBoxState extends State<SkeletonBox>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            color: Color.lerp(AppColors.surfaceMuted, AppColors.borderSubtle, _c.value),
            shape: widget.circle ? BoxShape.circle : BoxShape.rectangle,
            borderRadius: widget.circle ? null : BorderRadius.circular(widget.radius),
          ),
        ),
      ),
    );
  }
}

/// Ready-made skeletons.
class SkeletonLoader extends StatelessWidget {
  const SkeletonLoader({super.key, this.rows = 5, this.withAvatar = true});

  /// Row skeleton (avatar + two lines) repeated [rows] times.
  final int rows;
  final bool withAvatar;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppDimens.s2),
      child: Column(
        children: [
          for (var i = 0; i < rows; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppDimens.s3),
              child: Row(
                children: [
                  if (withAvatar) ...[
                    const SkeletonBox(width: AppDimens.avatarLg, height: AppDimens.avatarLg, circle: true),
                    const SizedBox(width: AppDimens.s3),
                  ],
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SkeletonBox(height: 16),
                        SizedBox(height: AppDimens.s2),
                        FractionallySizedBox(
                          widthFactor: 0.6,
                          child: SkeletonBox(height: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
