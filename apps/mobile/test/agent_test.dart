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

class PermissionCalendar extends FixtureCalendar {
  PermissionCalendar(super.profile);

  bool canWrite = true;
  String? writtenTitle;

  @override
  Future<void> ensureEvent(
    String meeting,
    String agent,
    Json slot, {
    String? title,
  }) async {
    if (!canWrite) throw const CalendarAuthorizationRequired();
    writtenTitle = title;
  }
}

void main() {
  test(
    'first sign-in initializes maps the meeting and calendar screens can read',
    () {
      final directory = Directory.systemTemp.createTempSync('meetmesh-store-');
      addTearDown(() => directory.deleteSync(recursive: true));
      final store = AgentStore(
        File('${directory.path}/state.json'),
        'test-agent',
      );
      addTearDown(store.close);

      expect(store.data['meetings'] as Json, isEmpty);
      expect(store.data['events'] as Json, isEmpty);
    },
  );

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
      if (r.url.path.endsWith('/calendarList')) {
        return http.Response(
          jsonEncode({
            'items': [
              {
                'id': 'demo',
                'summary': GoogleCalendar.title,
                'accessRole': 'owner',
              },
            ],
          }),
          200,
        );
      }
      if (r.url.path.endsWith('freeBusy')) {
        expect(jsonDecode(r.body)['items'], [
          {'id': 'demo'},
        ]);
        return http.Response(
          jsonEncode({
            'calendars': {
              'demo': {'busy': []},
            },
          }),
          200,
        );
      }
      expect(r.url.path, startsWith('/calendar/v3/calendars/demo/events'));
      if (r.method == 'GET') {
        return http.Response(
          jsonEncode(stored),
          wrote ? 200 : 404,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      stored = jsonDecode(r.body);
      wrote = true;
      inserts++;
      throw const SocketException('Lost reply');
    });
    final calendar = GoogleCalendar(httpClient, () async => 'synthetic');
    expect((await calendar.candidates(slot, 60, [])).length, 1);
    await expectLater(
      calendar.ensureEvent(
        'm',
        'a',
        slot,
        title: '  Tasarım   değerlendirmesi  ',
      ),
      throwsA(isA<SocketException>()),
    );
    await calendar.ensureEvent(
      'm',
      'a',
      slot,
      title: 'Tasarım değerlendirmesi',
    );
    expect(inserts, 1);
    expect(stored!.containsKey('attendees'), false);
    expect(stored!['summary'], 'Tasarım değerlendirmesi');
    revoked = true;
    await expectLater(
      calendar.ensureEvent('m', 'a', slot),
      throwsA(isA<CalendarAuthorizationRequired>()),
    );
  });
  test(
    'Google day preview reads all-day and timed events across pages',
    () async {
      int requests = 0;
      final client = MockClient((r) async {
        expect(r.method, 'GET');
        if (r.url.path.endsWith('/calendarList')) {
          return http.Response(
            jsonEncode({
              'items': [
                {
                  'id': 'primary',
                  'summary': GoogleCalendar.title,
                  'accessRole': 'owner',
                  'primary': true,
                },
                {
                  'id': 'shared',
                  'summary': GoogleCalendar.title,
                  'accessRole': 'writer',
                },
                {
                  'id': 'old',
                  'summary': 'Meetmash Takvimim',
                  'accessRole': 'owner',
                },
                {
                  'id': 'demo',
                  'summary': GoogleCalendar.title,
                  'accessRole': 'owner',
                },
              ],
            }),
            200,
          );
        }
        requests++;
        expect(r.url.path, '/calendar/v3/calendars/demo/events');
        expect(r.url.queryParameters['timeMin'], '2026-11-09T21:00:00.000Z');
        expect(r.url.queryParameters['timeMax'], '2026-11-10T21:00:00.000Z');
        expect(r.url.queryParameters['timeZone'], 'Europe/Istanbul');
        if (r.url.queryParameters['pageToken'] == 'page-2') {
          return http.Response(
            jsonEncode({
              'items': [
                {
                  'summary': 'Ders',
                  'start': {'dateTime': '2026-11-10T14:00:00+03:00'},
                  'end': {'dateTime': '2026-11-10T15:00:00+03:00'},
                },
              ],
            }),
            200,
          );
        }
        return http.Response(
          jsonEncode({
            'nextPageToken': 'page-2',
            'items': [
              {
                'summary': 'Tatil',
                'start': {'date': '2026-11-10'},
                'end': {'date': '2026-11-11'},
              },
            ],
          }),
          200,
        );
      });
      final events = await GoogleCalendar(client, () async => 'synthetic')
          .eventsOn(
            DateTime.utc(2026, 11, 9, 21),
            DateTime.utc(2026, 11, 10, 21),
            'Europe/Istanbul',
          );
      expect(requests, 2);
      expect(events.map((event) => (event.title, event.allDay)), [
        ('Tatil', true),
        ('Ders', false),
      ]);
      expect(events.last.start, DateTime.utc(2026, 11, 10, 11));
    },
  );
  test(
    'managed agenda sends the selected day and decodes Turkish titles',
    () async {
      final calendar = GoogleCalendar.managed((frame) async {
        expect(frame, {
          'kind': 'calendar.request',
          'operation': 'events',
          'start': '2026-11-09T21:00:00.000Z',
          'end': '2026-11-10T21:00:00.000Z',
          'zone': 'Europe/Istanbul',
        });
        return {
          'status': 200,
          'body': {
            'items': [
              {
                'summary': 'Öğle görüşmesi',
                'start': {'dateTime': '2026-11-10T13:00:00+03:00'},
                'end': {'dateTime': '2026-11-10T14:00:00+03:00'},
              },
            ],
          },
        };
      });
      final events = await calendar.eventsOn(
        DateTime.utc(2026, 11, 9, 21),
        DateTime.utc(2026, 11, 10, 21),
        'Europe/Istanbul',
      );
      expect(events.single.title, 'Öğle görüşmesi');
    },
  );
  test(
    'manual votes and partial writes keep the meeting pending until recovery',
    () async {
      final dir = Directory.systemTemp.createTempSync('meetmesh-dart-');
      final f = fixture('fixtures/calendar-v1.json'),
          wire = Wire(fixture('schemas/message.schema.json'));
      final agents = <String, MeetingAgent>{};
      final pending = <Json>[];
      final ids = List<String>.from(f['agents'].keys);
      final calendar = PermissionCalendar(f['agents'][ids.last]);
      var coordinatorOnline = false;
      MeetingAgent openAgent(String id) => MeetingAgent(
        id: id,
        keys: {for (final peer in ids) pair(id, peer): 'fixture'},
        wire: wire,
        store: AgentStore(File('${dir.path}/$id'), id),
        calendar: id == ids.last ? calendar : FixtureCalendar(f['agents'][id]),
        changed: () {},
        transmit: pending.add,
        canTransmit: () => id != ids.first || coordinatorOnline,
      );
      for (final id in ids) {
        agents[id] = openAgent(id);
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

      final coordinator = agents[ids.first]!;
      final m = await coordinator.schedule(
        ids,
        f['window'],
        60,
        title: '  Tasarım   değerlendirmesi  ',
      );
      expect(pending, isEmpty);
      expect(
        (coordinator.store.data['outbox'] as Map).values.every(
          (entry) => entry['attempts'] == 0,
        ),
        isTrue,
      );
      coordinatorOnline = true;
      await coordinator.tick();
      expect(
        pending
            .where((message) => message['type'] == 'REQUEST')
            .map((message) => message['payload']['title']),
        everyElement('Tasarım değerlendirmesi'),
      );
      await drain();
      expect(
        agents[ids[1]]!.store.data['meetings'][m]['status'],
        'AWAITING_USER',
      );
      await agents[ids[1]]!.vote(m, true);
      await drain();
      expect(agents.values.every((a) => a.store.data['events'].isEmpty), true);
      await agents[ids[2]]!.vote(m, true);
      calendar.canWrite = false;
      await drain();
      for (final a in agents.values) {
        await a.tick();
        await drain();
      }
      var denied = agents[ids.last]!;
      expect(coordinator.store.data['meetings'][m]['status'], 'COMMIT_PENDING');
      expect(coordinator.store.data['events'], hasLength(1));
      expect(denied.store.data['events'], isEmpty);
      expect(
        denied.store.data['meetings'][m]['error'],
        CalendarAuthorizationRequired.message,
      );

      denied.store.close();
      denied = agents[ids.last] = openAgent(ids.last);
      calendar.canWrite = true;
      await denied.retryCalendarWrites();
      await denied.tick();
      await drain();
      expect(
        agents.values.every((a) => a.store.data['events'].length == 1),
        true,
      );
      expect(agents[ids[0]]!.store.data['meetings'][m]['status'], 'CONFIRMED');
      expect(calendar.writtenTitle, 'Tasarım değerlendirmesi');
      for (final agent in agents.values) {
        expect(
          agent.store.data['meetings'][m]['title'],
          'Tasarım değerlendirmesi',
        );
        expect(
          agent.store.data['events'][m]['title'],
          'Tasarım değerlendirmesi',
        );
      }
      final moves = (coordinator.store.data['meetings'][m]['moves'] as List)
          .cast<Json>();
      expect(
        moves
            .where((move) => move['phase'] == 'AVAILABILITY')
            .map((move) => move['from']),
        unorderedEquals(ids.skip(1)),
      );
      expect(
        moves
            .where((move) => move['type'] == 'ACCEPT')
            .map((move) => move['from']),
        unorderedEquals(ids.skip(1)),
      );
    },
  );

  test('coordinator must approve a calendar overlap before sending', () async {
    final dir = Directory.systemTemp.createTempSync('meetmesh-overlap-');
    final wire = Wire(fixture('schemas/message.schema.json'));
    final slot = {
      'start': '2090-11-10T11:00:00.000Z',
      'end': '2090-11-10T12:00:00.000Z',
    };
    final busyCalendar = FixtureCalendar({
      'working': [slot],
      'busy': [slot],
      'preferences': [],
    });
    final freeCalendar = FixtureCalendar({
      'working': [slot],
      'busy': [],
      'preferences': [],
    });
    final pending = <Json>[];
    MeetingAgent open(String id, MeetingCalendar calendar) => MeetingAgent(
      id: id,
      keys: {pair('host', 'guest'): 'fixture'},
      wire: wire,
      store: AgentStore(File('${dir.path}/$id'), id),
      calendar: calendar,
      changed: () {},
      transmit: pending.add,
      automatic: true,
    );
    var host = open('host', busyCalendar);
    final guest = open('guest', freeCalendar);
    addTearDown(() {
      host.store.close();
      guest.store.close();
      dir.deleteSync(recursive: true);
    });

    await expectLater(
      host.schedule(['guest'], slot, 60),
      throwsA(isA<CalendarOverlapNeedsApproval>()),
    );
    expect(host.store.data['meetings'], isEmpty);
    expect(host.store.data['outbox'], isEmpty);
    expect(pending, isEmpty);

    final id = await host.schedule(
      ['guest'],
      slot,
      60,
      allowCalendarOverlap: true,
    );
    expect(pending.single['type'], 'REQUEST');
    expect(
      pending.single['payload'].containsKey('calendarOverlapApproved'),
      false,
    );
    host.store.close();
    host = open('host', busyCalendar);
    while (pending.isNotEmpty) {
      final message = pending.removeAt(0);
      await (message['toAgentId'] == 'host' ? host : guest).receive(message);
    }
    expect(host.store.data['meetings'][id]['decision'], 'COMMIT');
    expect(guest.store.data['meetings'][id]['calendarOverlapApproved'], isNull);
    await expectLater(
      host.schedule(['guest'], slot, 60, allowCalendarOverlap: true),
      throwsStateError,
    );
  });
}
