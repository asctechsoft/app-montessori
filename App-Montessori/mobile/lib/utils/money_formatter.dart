/// VND formatting (DESIGN_SYSTEM §14/§7, CONTRACT §2: money is an integer VND).
///
/// Vietnamese convention in every app language: `.` groups thousands, no
/// decimals, trailing ` đ`. `4100000` -> `4.100.000 đ`.
class MoneyFormatter {
  MoneyFormatter._();

  static const String unit = 'đ';

  /// `4.100.000` (no unit) - for input fields.
  static String digits(int amount) {
    final negative = amount < 0;
    final s = amount.abs().toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) buf.write('.');
      buf.write(s[i]);
    }
    return negative ? '-$buf' : buf.toString();
  }

  /// `4.100.000 đ`; negative `-1.000.000 đ`.
  static String format(int amount) => '${digits(amount)} $unit';

  /// Parses user input such as `4.100.000`, `4100000 đ` into integer VND.
  /// Returns null when there are no digits. A leading `-` is kept.
  static int? parse(String input) {
    final negative = input.trim().startsWith('-');
    final onlyDigits = input.replaceAll(RegExp(r'[^0-9]'), '');
    if (onlyDigits.isEmpty) return null;
    final value = int.tryParse(onlyDigits);
    if (value == null) return null;
    return negative ? -value : value;
  }
}
