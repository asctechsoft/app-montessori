/// Route names of the teacher role.
class RouteTeacher {
  RouteTeacher._();

  /// arguments: childId (String)
  static const String child = '/teacher/child';

  /// arguments: childId
  static const String pickup = '/teacher/pickup';
  static const String bulkAttendance = '/teacher/attendance/bulk';

  /// arguments: {childId, template: bool}
  static const String diaryEdit = '/teacher/diary/edit';
  static const String meds = '/teacher/meds';

  /// arguments: MedRequest
  static const String medDetail = '/teacher/meds/detail';
  static const String incidents = '/teacher/incidents';
  static const String incidentForm = '/teacher/incidents/new';
  static const String requests = '/teacher/requests';
  static const String payslips = '/teacher/payslips';
  static const String inbox = '/teacher/inbox';

  /// arguments: ThreadItem
  static const String thread = '/teacher/inbox/thread';
}
