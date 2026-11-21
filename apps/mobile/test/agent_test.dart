import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:meetmesh/agent/protocol.dart';
import 'package:meetmesh/agent/meeting_agent.dart';
import 'package:meetmesh/agent/store.dart';
import 'package:meetmesh/calendar/calendar.dart';

dynamic fixture(String path) =>
    jsonDecode(File('../../packages/protocol/$path').readAsStringSync());
void main() {
  test('shared Node/Dart wire fixtures, canonical bytes and MAC', () {
    final wire = Wire(fixture('schemas/message.schema.json'));
    for (final v in fixture('fixtures/messages.json')) {
      if (v['valid'] == true) {
        wire.validate(v['message']);
      } else {
        expect(
          () => wire.validate(v['message']),
          throwsA(anything),
          reason: v['name'],
        );
      }
    }
    final v = fixture('fixtures/mac-vectors.json');
    expect(signedBytes(v['message']), v['signingString']);
    expect(mac(v['message'], v['key']), v['mac']);
  });
  test(
    'ranks only common intervals and does not disclose private titles',
    () async {
      final f = fixture('fixtures/calendar-v1.json');
      final offers = <String, List<Json>>{};
      for (final id in f['agents'].keys) {
        offers[id] = await FixtureCalendar(
          f['agents'][id],
        ).candidates(f['window'], 60, []);
      }
      expect(jsonEncode(offers), isNot(contains('PRIVATE-')));
      expect(rank(offers.keys.toList(), offers).map((s) => s['score']), [
        220,
        180,
      ]);
      expect(rank(['agent-c', 'absent'], offers), isEmpty);
    },
  );
  test('Google freebusy failures and an insert with a lost reply', () async {
    bool wrote = false, revoked = false;
    int inserts = 0;
    Json? stored;
    final slot = {
      'start': '2030-11-10T11:00:00Z',
      'end': '2030-11-10T12:00:00Z',
    };
    final httpClient = MockClient((r) async {
      if (revoked) return http.Response('', 403);
      if (r.url.path.endsWith('freeBusy')) {
        return http.Response(
          jsonEncode({
            'calendars': {
              'primary': {'busy': []},
            },
          }),
          200,
        );
      }
      if (r.method == 'GET') {
        return http.Response(jsonEncode(stored), wrote ? 200 : 404);
      }
      stored = jsonDecode(r.body);
      wrote = true;
      inserts++;
      throw const SocketException('Lost reply');
    });
    final calendar = GoogleCalendar(httpClient, () async => 'synthetic');
    expect((await calendar.candidates(slot, 60, [])).length, 1);
    await expectLater(
      calendar.ensureEvent('m', 'a', slot),
      throwsA(isA<SocketException>()),
    );
    await calendar.ensureEvent('m', 'a', slot);
    expect(inserts, 1);
    expect(stored!.containsKey('attendees'), false);
    revoked = true;
    await expectLater(calendar.ensureEvent('m', 'a', slot), throwsStateError);
  });
  test(
    'three independent agents require a user vote, then each writes once',
    () async {
      final dir = Directory.systemTemp.createTempSync('meetmesh-dart-');
      final f = fixture('fixtures/calendar-v1.json'),
          wire = Wire(fixture('schemas/message.schema.json'));
      final agents = <String, MeetingAgent>{};
      final pending = <Json>[];
      final ids = List<String>.from(f['agents'].keys);
      for (final id in ids) {
        agents[id] = MeetingAgent(
          id: id,
          keys: {for (final peer in ids) pair(id, peer): 'fixture'},
          wire: wire,
          store: AgentStore(File('${dir.path}/$id'), id),
          calendar: FixtureCalendar(f['agents'][id]),
          changed: () {},
          transmit: pending.add,
        );
      }
      addTearDown(() {
        for (final a in agents.values) {
          a.store.close();
        }
        dir.deleteSync(recursive: true);
      });
      Future<void> drain() async {
        var i = 0;
        while (pending.isNotEmpty) {
          expect(i++, lessThan(500));
          final p = pending.removeAt(0);
          await agents[p['toAgentId']]!.receive(p);
        }
      }

      final m = await agents[ids.first]!.schedule(ids, f['window'], 60);
      await drain();
      expect(
        agents[ids[1]]!.store.data['meetings'][m]['status'],
        'AWAITING_USER',
      );
      await agents[ids[1]]!.vote(m, true);
      await drain();
      expect(agents.values.every((a) => a.store.data['events'].isEmpty), true);
      await agents[ids[2]]!.vote(m, true);
      await drain();
      for (final a in agents.values) {
        await a.tick();
        await drain();
      }
      expect(
        agents.values.every((a) => a.store.data['events'].length == 1),
        true,
      );
      expect(agents[ids[0]]!.store.data['meetings'][m]['status'], 'CONFIRMED');
    },
  );
}
