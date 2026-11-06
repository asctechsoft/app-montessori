import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../controller/session_controller.dart';
import '../../models/ui_models/app_role.dart';
import '../../values/app_colors.dart';
import '../common_components/bottom_nav.dart';
import 'role_tabs.dart';
import 'sync_status_bar.dart';

/// Shell of one role: sync/offline bar, the tab bodies (kept alive once
/// visited) and the 5-item bottom nav. Back on a non-first tab returns to the
/// first tab; back on the first tab leaves the app.
///
/// One class serves all three roles; the tabs come from [RoleTabs.of].
class RoleShell extends StatefulWidget {
  const RoleShell({super.key, required this.role});

  final AppRole role;

  @override
  State<RoleShell> createState() => _RoleShellState();
}

class _RoleShellState extends State<RoleShell> {
  int _index = 0;
  final Set<int> _visited = {0};
  late final List<ShellTab> _tabs = RoleTabs.of(widget.role);

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _index == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) setState(() => _index = 0);
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const SyncStatusBar(),
              Expanded(
                // The bottom nav owns the bottom inset; tab pages must not add it again.
                child: MediaQuery.removePadding(
                  context: context,
                  removeTop: true,
                  removeBottom: true,
                  // Rebuild all tabs when the scope changes so none keeps stale data.
                  child: Obx(() {
                    SessionController.to.scopeEpoch.value;
                    return IndexedStack(
                      index: _index,
                      children: [
                        for (var i = 0; i < _tabs.length; i++)
                          _visited.contains(i)
                              ? Builder(
                                  key: ValueKey('tab_${widget.role.code}_$i'),
                                  builder: _tabs[i].builder,
                                )
                              : const SizedBox.shrink(),
                      ],
                    );
                  }),
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: BottomNav(
          currentIndex: _index,
          onTap: (i) => setState(() {
            _index = i;
            _visited.add(i);
          }),
          items: [
            for (final t in _tabs)
              BottomNavItem(
                label: t.labelKey.tr,
                icon: t.icon,
                activeIcon: t.activeIcon,
              ),
          ],
        ),
      ),
    );
  }
}
