import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';

/// Loads `lib/xml_strings/<folder>/strings.xml` into a key -> text map
/// (same unescaping as asc_common AscLocale).
Map<String, String> loadStrings(String folder) {
  final xml = File('lib/xml_strings/$folder/strings.xml').readAsStringSync();
  final re = RegExp(r'<string name="([^"]+)">(.*?)</string>', dotAll: true);
  final out = <String, String>{};
  for (final m in re.allMatches(xml)) {
    var v = m
        .group(2)!
        .replaceAll("\\'", "'")
        .replaceAll('\\"', '"')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&');
    for (var i = 1; i <= 8; i++) {
      v = v.replaceAll('%$i\$s', '@args$i');
    }
    out[m.group(1)!] = v;
  }
  return out;
}

class TestTranslations extends Translations {
  @override
  Map<String, Map<String, String>> get keys => {
    'vi_VN': loadStrings('values-vi'),
    'en_US': loadStrings('values'),
  };
}

/// Wraps [child] in a Vietnamese GetMaterialApp with the real strings.
Widget vietnameseApp(Widget child) => GetMaterialApp(
  translations: TestTranslations(),
  locale: const Locale('vi', 'VN'),
  fallbackLocale: const Locale('en', 'US'),
  home: Scaffold(body: Center(child: child)),
);
