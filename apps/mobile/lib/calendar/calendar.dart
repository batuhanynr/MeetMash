import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import '../agent/protocol.dart';

DateTime startOf(Json slot) => DateTime.parse(slot['start']);
DateTime endOf(Json slot) => DateTime.parse(slot['end']);
bool overlaps(Json a, Json b) =>
    startOf(a).isBefore(endOf(b)) && startOf(b).isBefore(endOf(a));
bool sameSlot(Json a, Json b) =>
    startOf(a).isAtSameMomentAs(startOf(b)) &&
    endOf(a).isAtSameMomentAs(endOf(b));
Json times(Json slot) => {'start': utc(startOf(slot)), 'end': utc(endOf(slot))};

abstract interface class MeetingCalendar {
  Future<List<Json>> candidates(Json window, int duration, List<Json> reserved);
  Future<void> ensureEvent(String meeting, String agent, Json slot);
}

void validateWindow(Json window, int duration) {
  final length = parseWireTime(window['end']).difference(
    parseWireTime(window['start']),
  );
  if (duration < 1 ||
      duration > 1440 ||
      length < Duration(minutes: duration) ||
      length > const Duration(hours: 64)) {
    throw const FormatException(
      'Aralık toplantı süresinden kısa veya 64 saatten uzun olamaz.',
    );
  }
}

class CalendarAuthorizationRequired implements Exception {
  const CalendarAuthorizationRequired();
  static const message = 'Takvimden Google hesabına yeniden izin ver.';
}

List<Json> generate(
  Json window,
  int duration,
  List<Json> working,
  List<Json> busy,
  List<Json> preferences,
) {
  validateWindow(window, duration);
  final results = <Json>[];
  for (
    var start = startOf(window);
    !start.add(Duration(minutes: duration)).isAfter(endOf(window));
    start = start.add(const Duration(minutes: 30))
  ) {
    final end = start.add(Duration(minutes: duration));
    final slot = {'start': utc(start), 'end': utc(end)};
    if (!working.any(
          (w) => !start.isBefore(startOf(w)) && !end.isAfter(endOf(w)),
        ) ||
        busy.any((b) => overlaps(b, slot))) {
      continue;
    }
    final pref = preferences
        .where((p) => start.isAtSameMomentAs(startOf(p)))
        .firstOrNull;
    results.add({...slot, 'score': pref?['score'] ?? 50});
  }
  return results;
}

List<Json> rank(List<dynamic> participants, Map offers) {
  if (participants.isEmpty || !participants.every(offers.containsKey)) {
    return [];
  }
  final common = <Json>[];
  for (final candidate in offers[participants.first]) {
    final score = (participants
        .map(
          (p) => (offers[p] as List)
              .where((s) => sameSlot(s, candidate))
              .firstOrNull,
        )
        .toList());
    if (score.contains(null)) continue;
    common.add({
      ...times(candidate),
      'score': score.fold<int>(0, (n, v) => n + v['score'] as int),
    });
  }
  return common..sort((a, b) {
    final byScore = (b['score'] as int).compareTo(a['score']);
    return byScore != 0 ? byScore : startOf(a).compareTo(startOf(b));
  });
}

class FixtureCalendar implements MeetingCalendar {
  final Json profile;
  FixtureCalendar(this.profile);
  @override
  Future<List<Json>> candidates(
    Json window,
    int duration,
    List<Json> reserved,
  ) async => generate(
    window,
    duration,
    List<Json>.from(profile['working']),
    [...List<Json>.from(profile['busy']), ...reserved],
    List<Json>.from(profile['preferences']),
  );
  // The caller commits the synthetic event together with APPLIED in its local snapshot.
  @override
  Future<void> ensureEvent(String meeting, String agent, Json slot) async {}
}

class GoogleCalendar implements MeetingCalendar {
  final http.Client client;
  final Future<String> Function() token;
  GoogleCalendar(this.client, this.token);
  static String eventId(String meeting, String agent) =>
      sha256.convert(utf8.encode(jsonEncode([agent, meeting]))).toString();
  Future<http.Response> _call(String method, String path, [Json? body]) async {
    final request = http.Request(
      method,
      Uri.https('www.googleapis.com', '/calendar/v3/$path'),
    );
    request.headers.addAll({
      'authorization': 'Bearer ${await token()}',
      'content-type': 'application/json',
    });
    if (body != null) request.body = jsonEncode(body);
    final res = await client
        .send(request)
        .then(http.Response.fromStream)
        .timeout(const Duration(seconds: 12));
    if (res.statusCode == 401 || res.statusCode == 403) {
      throw const CalendarAuthorizationRequired();
    }
    return res;
  }

  @override
  Future<List<Json>> candidates(
    Json window,
    int duration,
    List<Json> reserved,
  ) async {
    validateWindow(window, duration);
    final now = DateTime.now();
    if (!endOf(window).isAfter(now)) {
      throw const FormatException('Geçmiş takvim aralığı');
    }
    final res = await _call('POST', 'freeBusy', {
      'timeMin': window['start'],
      'timeMax': window['end'],
      'items': [
        {'id': 'primary'},
      ],
    });
    if (res.statusCode != 200) {
      throw StateError('Calendar availability unavailable');
    }
    final cal = jsonDecode(res.body)['calendars']['primary'];
    if (cal?['busy'] is! List || cal['errors'] != null) {
      throw StateError('Calendar availability unavailable');
    }
    return generate(
      window,
      duration,
      [
        {
          'start': startOf(window).isBefore(now) ? utc(now) : window['start'],
          'end': window['end'],
        },
      ],
      [...List<Json>.from(cal['busy']), ...reserved],
      [],
    );
  }

  @override
  Future<void> ensureEvent(String meeting, String agent, Json slot) async {
    final id = eventId(meeting, agent);
    final path = 'calendars/primary/events';
    Future<bool> existing() async {
      final res = await _call('GET', '$path/$id');
      if (res.statusCode == 404) return false;
      if (res.statusCode != 200) throw StateError('Calendar lookup failed');
      final e = jsonDecode(res.body);
      if (e['status'] == 'cancelled' ||
          e['extendedProperties']?['private']?['meetmesh'] != id ||
          !sameSlot({
            'start': e['start']['dateTime'],
            'end': e['end']['dateTime'],
          }, slot)) {
        throw StateError('Calendar event changed externally');
      }
      return true;
    }

    if (await existing()) return;
    final res = await _call('POST', path, {
      'id': id,
      'summary': 'MeetMesh',
      'start': {'dateTime': slot['start']},
      'end': {'dateTime': slot['end']},
      'extendedProperties': {
        'private': {'meetmesh': id},
      },
    });
    if (res.statusCode >= 200 && res.statusCode < 300) return;
    if (res.statusCode == 409 && await existing()) return;
    throw StateError('Calendar write pending');
  }
}
