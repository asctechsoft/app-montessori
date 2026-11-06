import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/session_controller.dart';
import '../../models/data_models/session_context.dart';
import '../../models/ui_models/app_role.dart';
import '../../values/app_dimensions.dart';
import '../common_components/app_icons.dart';
import '../common_components/scope_selector.dart';

/// [ScopeSelector]s wired to the session: the child cards (parents) and the
/// campus chooser. Switching goes through `SessionController`, which wipes the
/// cache of the previous scope first, and asks before discarding unsaved input.
class SessionScopeBar extends StatelessWidget {
  const SessionScopeBar({super.key});

  @override
  Widget build(BuildContext context) {
    final s = SessionController.to;
    return Obx(() {
      final ctx = s.context.value;
      if (ctx == null) return const SizedBox.shrink();
      final campuses = s.campusChoices;
      final kids = s.childChoices;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (campuses.length > 1) ...[
            ScopeSelector(
              label: 'scope_campus'.tr,
              sheetTitle: 'scope_pick_campus'.tr,
              leadingIcon: AppIcons.school,
              options: [
                for (final c in campuses) ScopeOption(id: c.id, title: c.name),
              ],
              selectedId: ctx.campusId,
              hasUnsavedChanges: () => s.hasUnsavedChanges,
              onSelected: (id) => s.selectContext(
                SessionContext(orgId: ctx.orgId, campusId: id, role: ctx.role),
              ),
            ),
            const SizedBox(height: AppDimens.s4),
          ],
          if (ctx.role == AppRole.parent && kids.isNotEmpty)
            ScopeSelector(
              style: ScopeSelectorStyle.cards,
              label: kids.length > 1 ? 'scope_child'.tr : null,
              options: [
                for (final k in kids)
                  ScopeOption(id: k.id, title: k.fullName, subtitle: k.className),
              ],
              selectedId: ctx.childId,
              hasUnsavedChanges: () => s.hasUnsavedChanges,
              onSelected: s.selectChild,
            ),
        ],
      );
    });
  }

}
