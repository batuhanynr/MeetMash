import 'dart:collection';
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:json_schema/json_schema.dart';

typedef Json = Map<String, dynamic>;
final _random = Random.secure();
String newId() => List.generate(
  16,
  (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
).join();
String utc(DateTime time) => DateTime.fromMillisecondsSinceEpoch(
  time.millisecondsSinceEpoch,
  isUtc: true,
).toIso8601String();
Object? _sorted(Object? value) => switch (value) {
  Map<String, dynamic>() => SplayTreeMap<String, dynamic>.from(
    value.map((k, v) => MapEntry(k, _sorted(v))),
  ),
  List() => value.map(_sorted).toList(),
  _ => value,
};
String canonical(Object? value) => jsonEncode(_sorted(value));
String signedBytes(Json value) => canonical(Map.of(value)..remove('auth'));
String mac(Json value, String key) => Hmac(
  sha256,
  utf8.encode(key),
).convert(utf8.encode(signedBytes(value))).toString();
String pair(String a, String b) => ([a, b]..sort()).join(':');
bool sameMac(String a, String b) {
  if (a.length != b.length) return false;
  var difference = 0;
  for (var i = 0; i < a.length; i++) {
    difference |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
  }
  return difference == 0;
}

DateTime parseWireTime(String input) {
  final match = RegExp(
    r'^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(\.\d{1,3})?(Z|[+-](\d\d):(\d\d))$',
  ).firstMatch(input);
  if (match == null) throw const FormatException('Invalid timestamp');
  int part(int i) => int.parse(match[i]!);
  final day = DateTime.utc(part(1), part(2), part(3));
  if (day.year != part(1) ||
      day.month != part(2) ||
      day.day != part(3) ||
      part(4) > 23 ||
      part(5) > 59 ||
      part(6) > 59 ||
      match[9] != null && (part(9) > 23 || part(10) > 59)) {
    throw const FormatException('Invalid timestamp');
  }
  return DateTime.parse(input);
}

class Wire {
  final JsonSchema schema;
  Wire(Object schema) : schema = JsonSchema.create(schema);
  void validate(Json message) {
    if (!schema.validate(message).isValid) {
      throw const FormatException('Invalid message');
    }
    void range(Json value, String start, String end) {
      if (!parseWireTime(value[end]).isAfter(parseWireTime(value[start]))) {
        throw const FormatException('Invalid time range');
      }
    }

    range(message, 'createdAt', 'expiresAt');
    final p = message['payload'];
    if (p['deadline'] is String) parseWireTime(p['deadline']);
    for (final slot in [p['window'], p['slot'], ...?p['slots']]) {
      if (slot != null) range(slot, 'start', 'end');
    }
  }
}
