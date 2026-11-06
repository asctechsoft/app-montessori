import 'package:get/get.dart';

import '../configs/app_config.dart';

/// Date/time formatting (DESIGN_SYSTEM §7: `dd/MM/yyyy`, `HH:mm`; CONTRACT §2:
/// `dayKey` = `YYYY-MM-DD` in the campus timezone, events are UTC timestamps).
class DateFormatter {
  DateFormatter._();

  static String _pad2(int n) => n.toString().padLeft(2, '0');

  /// `16/10/2026`
  static String date(DateTime d) => '${_pad2(d.day)}/${_pad2(d.month)}/${d.year}';

  /// `15:00`
  static String time(DateTime d) => '${_pad2(d.hour)}:${_pad2(d.minute)}';

  /// `15/10/2026 15:00`
  static String dateTime(DateTime d) => '${date(d)} ${time(d)}';

  /// `2026-10-16`
  static String dayKey(DateTime d) => '${d.year}-${_pad2(d.month)}-${_pad2(d.day)}';

  /// Parses `YYYY-MM-DD` (null when malformed).
  static DateTime? parseDayKey(String? key) {
    if (key == null) return null;
    final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(key);
    if (m == null) return null;
    final y = int.parse(m.group(1)!);
    final mo = int.parse(m.group(2)!);
    final d = int.parse(m.group(3)!);
    final dt = DateTime(y, mo, d);
    // Reject 2026-02-31 style overflow.
    if (dt.year != y || dt.month != mo || dt.day != d) return null;
    return dt;
  }

  /// Parses user text `dd/MM/yyyy` (null when invalid).
  static DateTime? parseDate(String? text) {
    if (text == null) return null;
    final m = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})$').firstMatch(text.trim());
    if (m == null) return null;
    final d = int.parse(m.group(1)!);
    final mo = int.parse(m.group(2)!);
    final y = int.parse(m.group(3)!);
    final dt = DateTime(y, mo, d);
    if (dt.year != y || dt.month != mo || dt.day != d) return null;
    return dt;
  }

  /// `Thứ Sáu, 16/10/2026` (weekday names from the XML strings).
  static String weekdayDate(DateTime d) =>
      '${'weekday_${d.weekday}'.tr}, ${date(d)}';

  /// "Hôm nay" / "Hôm qua" style label is left to features; this returns a
  /// stable relative day word only for today/yesterday, else [date].
  static String relativeDay(DateTime d, {DateTime? now}) {
    final today = _dateOnly(now ?? DateTime.now());
    final diff = today.difference(_dateOnly(d)).inDays;
    if (diff == 0) return 'date_today'.tr;
    if (diff == 1) return 'date_yesterday'.tr;
    return date(d);
  }

  static DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);
}

/// Campus wall clock. The app shows event times in the campus timezone, not
/// the phone's. Vietnam has no DST, so a fixed offset table is enough; an
/// unknown zone falls back to the default campus zone (UTC+7).
class CampusClock {
  const CampusClock(this.timezone);

  final String timezone;

  static const Map<String, Duration> _offsets = {
    'Asia/Ho_Chi_Minh': Duration(hours: 7),
    'Asia/Saigon': Duration(hours: 7),
    'Asia/Bangkok': Duration(hours: 7),
    'Asia/Phnom_Penh': Duration(hours: 7),
    'Asia/Vientiane': Duration(hours: 7),
    'Asia/Jakarta': Duration(hours: 7),
    'Asia/Singapore': Duration(hours: 8),
    'Asia/Kuala_Lumpur': Duration(hours: 8),
    'Asia/Manila': Duration(hours: 8),
    'Asia/Shanghai': Duration(hours: 8),
    'Asia/Tokyo': Duration(hours: 9),
    'Asia/Seoul': Duration(hours: 9),
    'UTC': Duration.zero,
  };

  Duration get offset =>
      _offsets[timezone] ?? _offsets[AppConfig.defaultTimezone]!;

  /// Wall-clock `DateTime` (marked UTC only to avoid device-zone math) of an instant.
  DateTime wall(DateTime instant) => instant.toUtc().add(offset);

  /// `HH:mm` of [instant] in the campus timezone.
  String time(DateTime instant) => DateFormatter.time(wall(instant));

  /// `dd/MM/yyyy` of [instant] in the campus timezone.
  String date(DateTime instant) => DateFormatter.date(wall(instant));

  /// `dd/MM/yyyy HH:mm` of [instant] in the campus timezone.
  String dateTime(DateTime instant) => DateFormatter.dateTime(wall(instant));

  /// Campus `dayKey` of [instant] (defaults to now).
  String dayKey([DateTime? instant]) =>
      DateFormatter.dayKey(wall(instant ?? DateTime.now()));
}
