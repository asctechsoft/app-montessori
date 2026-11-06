// Verifies every translation key used in lib/ exists in tool/strings_src.dart,
// and lists keys that are defined but never used.
//
// Usage (from mobile/):  dart run tool/check_strings.dart   (exit 1 when keys are missing)
//
// Detected usages:
//   'key'.tr   'key'.trParams(...)   'key'.trArgs(...)
//   plus string literals that start with a known "indirect" prefix (keys built
//   in tables: role_*, status_*, tab_*, screen_*, weekday_*), since those are
//   passed around as plain strings and translated later with `.tr`.
import 'dart:io';

import 'strings_src.dart';

final _direct = RegExp(r"'([a-z][a-z0-9_]*)'\s*\.tr(?:Params|Args)?\b");
final _indirect = RegExp(
  r"'((?:role|status|tab|screen|weekday|nav)_[a-z0-9_]+)'",
);
final _dynamic = RegExp(r'^(weekday)_\d+$');

void main() {
  final used = <String>{};
  for (final f in Directory('lib')
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))) {
    final s = f
        .readAsLinesSync()
        .where((l) => !l.trimLeft().startsWith('//'))
        .join('\n');
    for (final m in _direct.allMatches(s)) {
      used.add(m.group(1)!);
    }
    for (final m in _indirect.allMatches(s)) {
      used.add(m.group(1)!);
    }
  }
  // Keys derived from enum names (`role_${code}`, `weekday_${n}`).
  used.addAll(['role_parent', 'role_teacher', 'role_principal']);
  used.addAll([for (var i = 1; i <= 7; i++) 'weekday_$i']);

  final defined = kStrings.keys.toSet();
  final missing = (used.difference(defined).toList()
    ..removeWhere(_dynamic.hasMatch))
    ..sort();
  final unused = defined.difference(used).toList()..sort();
  stdout.writeln('missing: $missing');
  stdout.writeln('unused : $unused');
  exit(missing.isEmpty ? 0 : 1);
}
