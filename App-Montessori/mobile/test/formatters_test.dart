import 'package:app_montessori/utils/date_formatter.dart';
import 'package:app_montessori/utils/money_formatter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('MoneyFormatter', () {
    test('formats integer VND with dot grouping and unit', () {
      expect(MoneyFormatter.format(4100000), '4.100.000 đ');
      expect(MoneyFormatter.format(500000), '500.000 đ');
      expect(MoneyFormatter.format(0), '0 đ');
      expect(MoneyFormatter.format(999), '999 đ');
      expect(MoneyFormatter.format(1000), '1.000 đ');
      expect(MoneyFormatter.format(-1000000), '-1.000.000 đ');
      expect(MoneyFormatter.digits(3600000), '3.600.000');
    });

    test('parses user input back to integer', () {
      expect(MoneyFormatter.parse('4.100.000'), 4100000);
      expect(MoneyFormatter.parse('4.100.000 đ'), 4100000);
      expect(MoneyFormatter.parse('4100000'), 4100000);
      expect(MoneyFormatter.parse('-1.000.000 đ'), -1000000);
      expect(MoneyFormatter.parse(''), isNull);
      expect(MoneyFormatter.parse('abc'), isNull);
    });

    test('contract example: 500.000 old debt + 3.600.000 = 4.100.000', () {
      expect(MoneyFormatter.format(500000 + 3600000), '4.100.000 đ');
      expect(MoneyFormatter.format(4100000 - 2000000), '2.100.000 đ');
    });
  });

  group('DateFormatter', () {
    test('dd/MM/yyyy, HH:mm and dayKey', () {
      final d = DateTime(2026, 10, 16, 7, 5);
      expect(DateFormatter.date(d), '16/10/2026');
      expect(DateFormatter.time(d), '07:05');
      expect(DateFormatter.dateTime(d), '16/10/2026 07:05');
      expect(DateFormatter.dayKey(d), '2026-10-16');
    });

    test('parses and rejects invalid dates', () {
      expect(DateFormatter.parseDayKey('2026-10-16'), DateTime(2026, 10, 16));
      expect(DateFormatter.parseDayKey('2026-02-31'), isNull);
      expect(DateFormatter.parseDayKey('16/10/2026'), isNull);
      expect(DateFormatter.parseDate('16/10/2026'), DateTime(2026, 10, 16));
      expect(DateFormatter.parseDate('31/02/2026'), isNull);
    });
  });

  group('CampusClock', () {
    test('shows the campus wall clock, not the phone zone', () {
      const clock = CampusClock('Asia/Ho_Chi_Minh');
      final instant = DateTime.utc(2026, 10, 16, 8, 0); // 15:00 in Vietnam
      expect(clock.time(instant), '15:00');
      expect(clock.date(instant), '16/10/2026');
      // After 17:00 UTC the campus is already on the next day.
      expect(clock.dayKey(DateTime.utc(2026, 10, 16, 18, 0)), '2026-10-17');
    });

    test('unknown zone falls back to the default campus zone', () {
      expect(
        const CampusClock('Mars/Olympus').time(DateTime.utc(2026, 1, 1, 0, 0)),
        '07:00',
      );
      expect(
        const CampusClock('Asia/Tokyo').time(DateTime.utc(2026, 1, 1, 0, 0)),
        '09:00',
      );
    });
  });
}
