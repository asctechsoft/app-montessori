import 'package:get/get.dart';

/// Human label for a guardian relation. Known codes (as written by seed/backend)
/// are translated; free text typed by a parent is shown as typed.
String relationLabel(String raw) {
  final v = raw.trim();
  const keys = {
    'mother': 'relation_mother',
    'father': 'relation_father',
    'grandmother': 'relation_grandmother',
    'grandfather': 'relation_grandfather',
    'uncle': 'relation_uncle',
    'aunt': 'relation_aunt',
    'sibling': 'relation_sibling',
    'guardian': 'relation_guardian',
    'other': 'relation_other',
  };
  final k = keys[v.toLowerCase()];
  return k == null ? v : k.tr;
}

/// Label for a leave `reasonId` (sick/family/travel/other); unknown ids are shown as written.
String leaveReasonLabel(String id) => switch (id) {
  'sick' => 'p03_reason_sick'.tr,
  'family' => 'p03_reason_family'.tr,
  'travel' => 'p03_reason_travel'.tr,
  'other' => 'p03_reason_other'.tr,
  _ => id,
};
