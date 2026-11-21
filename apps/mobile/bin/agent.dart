import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:meetmesh/agent/connection.dart';
import 'package:meetmesh/agent/meeting_agent.dart';
import 'package:meetmesh/agent/protocol.dart';
import 'package:meetmesh/agent/store.dart';
import 'package:meetmesh/calendar/calendar.dart';

Future<void> main(List<String> args) async {
  if (args.length != 4) {
    stderr.writeln(
      'dart run bin/agent.dart ACCOUNT_JSON STATE_FILE SCHEMA FIXTURE',
    );
    exitCode = 64;
    return;
  }
  final config = AccountConfig(jsonDecode(File(args[0]).readAsStringSync()));
  if (config.provider != 'fixture') {
    throw StateError('Harness requires synthetic calendars');
  }
  final store = AgentStore(File(args[1]), config.id);
  final connection = AgentConnection(config, () {});
  var dropAck = Platform.environment['M4_FAULT'] == 'first-ack';
  final agent = MeetingAgent(
    id: config.id,
    keys: config.keys,
    wire: Wire(jsonDecode(File(args[2]).readAsStringSync())),
    store: store,
    calendar: FixtureCalendar(
      jsonDecode(File(args[3]).readAsStringSync())['agents'][config.id],
    ),
    transmit: (frame) {
      if (dropAck && frame['type'] == 'ACK') {
        dropAck = false;
        stdout.writeln(
          jsonEncode({
            'event': 'fault.drop',
            'meetingId': frame['meetingId'],
            'messageId': frame['messageId'],
            'ackFor': frame['payload']['ackForMessageId'],
          }),
        );
        return;
      }
      connection.send(frame);
    },
    changed: () {},
    automatic: true,
  );
  connection.agent = agent;
  await connection.connect();
  void reply(Json value) =>
      stdout.writeln(jsonEncode({'kind': 'response', ...value}));
  reply({'kind': 'ready', 'agentId': config.id});
  bool ticking = false;
  final timer = Timer.periodic(const Duration(milliseconds: 200), (_) async {
    if (ticking || !connection.online) return;
    ticking = true;
    try {
      await agent.tick();
    } finally {
      ticking = false;
    }
  });
  try {
    await for (final line
        in stdin.transform(utf8.decoder).transform(const LineSplitter())) {
      final c = jsonDecode(line);
      try {
        switch (c['command']) {
          case 'meeting':
            await agent.idle;
            final m = store.data['meetings'][c['meetingId']];
            reply({
              'requestId': c['requestId'],
              'meeting': m == null
                  ? null
                  : {
                      ...m,
                      'eventCount':
                          store.data['events'].containsKey(c['meetingId'])
                          ? 1
                          : 0,
                    },
            });
            break;
          case 'preview':
            final result = await connection.control({
              'kind': 'meeting.preview',
              'text': c['text'],
              'timeZone': 'Europe/Istanbul',
            });
            reply({'requestId': c['requestId'], 'preview': result});
            break;
          case 'schedule':
            final id = await agent.schedule(
              List<String>.from(c['participantAgentIds']),
              c['window'],
              c['durationMinutes'],
              meetingId: c['meetingId'],
            );
            reply({'requestId': c['requestId'], 'meetingId': id});
            break;
          case 'stop':
            return;
          default:
            throw StateError('Unknown command');
        }
      } catch (_) {
        reply({'requestId': c['requestId'], 'error': 'Invalid command'});
      }
    }
  } finally {
    timer.cancel();
    await connection.close();
    await agent.idle;
    store.close();
  }
}
