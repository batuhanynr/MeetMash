import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meetmesh/agent/agent_picker.dart';
import 'package:meetmesh/agent/meeting_timeline.dart';
import 'package:meetmesh/agent/protocol.dart';
import 'package:meetmesh/app.dart';
import 'package:meetmesh/calendar/calendar.dart';
import 'package:meetmesh/calendar/calendar_clock.dart';
import 'package:meetmesh/calendar/calendar_preview.dart';
import 'package:meetmesh/calendar/meeting_window_fields.dart';

void main() {
  testWidgets('meeting timeline shows each actor with the newest move first', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('tr'),
        supportedLocales: const [Locale('tr')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: Scaffold(
          body: MeetingTimeline(
            clock: const CalendarClock('Europe/Istanbul'),
            agentLabel: (id) => id == 'ege' ? 'Ege' : 'Batuhan',
            moves: [
              {
                'from': 'batuhan',
                'to': 'ege',
                'type': 'REQUEST',
                'at': '2026-11-21T10:00:00Z',
              },
              {
                'from': 'ege',
                'to': 'batuhan',
                'type': 'PROPOSE',
                'phase': 'AVAILABILITY',
                'count': 2,
                'at': '2026-11-21T10:01:00Z',
              },
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final answer = find.text('Müsaitlik yanıtı');
    expect(
      tester.getTopLeft(answer).dy,
      lessThan(tester.getTopLeft(find.text('Toplantı isteği')).dy),
    );
    expect(find.textContaining('Ege → Batuhan · 2 uygun saat'), findsOneWidget);
  });

  testWidgets('opens the app shell', (tester) async {
    await tester.pumpWidget(const MeetMeshApp());
    expect(find.text('MeetMesh'), findsOneWidget);
  });

  testWidgets('Turkish date picker and 24-hour wheels keep the selected day', (
    tester,
  ) async {
    const clock = CalendarClock('Europe/Istanbul');
    final start = DateTime.utc(2003, 1, 1, 18, 41);
    final end = start.add(const Duration(hours: 1));
    MeetingWindow? selected;
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('tr'),
        supportedLocales: const [Locale('tr')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: Scaffold(
          body: MeetingWindowFields(
            clock: clock,
            window: (start: start, end: end),
            futureOnly: false,
            onChanged: (value) => selected = value,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(clock.range(start, end), '01.01.2003 20:41 – 21:41');
    expect(find.text('01.01.2003'), findsOneWidget);
    await tester.tap(find.text('Tarih aralığı'));
    await tester.pumpAndSettle();
    expect(find.byType(DateRangePickerDialog), findsOneWidget);
    await tester.tap(find.text('Seç'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Başlangıç'));
    await tester.pumpAndSettle();
    final picker = tester.widget<CupertinoDatePicker>(
      find.byType(CupertinoDatePicker),
    );
    expect(picker.use24hFormat, true);
    expect(picker.initialDateTime.hour, 20);
    expect(picker.initialDateTime.minute, 41);
    expect(find.text('Başlangıç saati'), findsOneWidget);
    await tester.drag(find.byType(CupertinoPicker).first, const Offset(0, -56));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seç'));
    await tester.pumpAndSettle();
    expect(selected!.start, isNot(start));
    expect(clock.day(selected!.start), clock.day(start));
    expect(selected!.end, end);
    final confirmed = selected;
    await tester.tap(find.text('Bitiş'));
    await tester.pumpAndSettle();
    expect(find.text('Bitiş saati'), findsOneWidget);
    await tester.tap(find.text('Vazgeç'));
    await tester.pumpAndSettle();
    expect(selected, confirmed);
  });

  testWidgets('calendar shows only events overlapping the selected day', (
    tester,
  ) async {
    const clock = CalendarClock('Europe/Istanbul');
    final saved = <Json>[
      {'start': '2026-11-10T20:30:00Z', 'end': '2026-11-10T21:30:00Z'},
    ];
    final calendar = FixtureCalendar({
      'busy': [
        {'start': '2026-11-10T10:00:00Z', 'end': '2026-11-10T11:00:00Z'},
      ],
    });
    var day = DateTime(2026, 11, 10);
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('tr'),
        supportedLocales: const [Locale('tr')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) => SingleChildScrollView(
              child: CalendarPreview(
                clock: clock,
                calendar: calendar,
                savedEvents: saved,
                day: day,
                onDateChanged: (value) => setState(() => day = value),
                authorizationRevision: 0,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Meşgul'), findsOneWidget);
    expect(find.text('10.11.2026 23:30 – 11.11.2026 00:30'), findsOneWidget);
    await tester.tap(find.text('11'));
    await tester.pumpAndSettle();
    expect(find.text('Meşgul'), findsNothing);
    expect(find.text('MeetMesh'), findsOneWidget);
    await tester.tap(find.text('12'));
    await tester.pumpAndSettle();
    expect(find.text('Bu gün için etkinlik yok.'), findsOneWidget);
  });

  testWidgets('calendar caches the visible month and replaces it on pull', (
    tester,
  ) async {
    final key = GlobalKey<CalendarPreviewState>();
    var calls = 0;
    var decemberCalls = 0;
    final next = Completer<Json>();
    final calendar = GoogleCalendar.managed((request) async {
      if (request['start'] == '2026-11-30T21:00:00.000Z') {
        decemberCalls++;
        expect(request['end'], '2026-12-31T21:00:00.000Z');
        return {
          'status': 200,
          'body': {'items': []},
        };
      }
      calls++;
      expect(request['start'], '2026-10-31T21:00:00.000Z');
      expect(request['end'], '2026-11-30T21:00:00.000Z');
      return calls > 1
          ? next.future
          : {
              'status': 200,
              'body': {
                'items': [
                  {
                    'summary': 'Seminer',
                    'start': {'date': '2026-11-10'},
                    'end': {'date': '2026-11-11'},
                  },
                ],
              },
            };
    });
    var day = DateTime(2026, 11, 10);
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('tr'),
        supportedLocales: const [Locale('tr')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) => RefreshIndicator(
              onRefresh: () => key.currentState!.refresh(),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  CalendarPreview(
                    key: key,
                    clock: const CalendarClock('Europe/Istanbul'),
                    calendar: calendar,
                    savedEvents: const [],
                    day: day,
                    onDateChanged: (value) => setState(() => day = value),
                    authorizationRevision: 0,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final monthGrid = find.byType(Card).first;
    await tester.drag(monthGrid, const Offset(-200, 0));
    await tester.pumpAndSettle();
    expect(find.text('Aralık 2026'), findsOneWidget);
    expect(decemberCalls, 1);
    await tester.drag(monthGrid, const Offset(200, 0));
    await tester.pumpAndSettle();
    expect(find.text('Kasım 2026'), findsOneWidget);
    expect(calls, 1);
    expect(
      find.bySemanticsLabel(RegExp('10.11.2026, 1 etkinlik')),
      findsOneWidget,
    );
    await tester.tap(find.text('11'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('10'));
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('Seminer'), findsOneWidget);

    await tester.drag(find.byType(ListView), const Offset(0, 450));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(calls, 2);
    expect(find.text('Seminer'), findsOneWidget);
    next.complete({
      'status': 200,
      'body': {'items': []},
    });
    await tester.pumpAndSettle();
    expect(find.text('Seminer'), findsNothing);
    expect(
      find.bySemanticsLabel(RegExp('10.11.2026, 0 etkinlik')),
      findsOneWidget,
    );
  });

  testWidgets(
    'planning form survives scrolling and returning from the calendar',
    (tester) async {
      var tab = 1;
      var day = DateTime(2026, 11, 10);
      final calendar = FixtureCalendar({'busy': <Json>[]});
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('tr'),
          supportedLocales: const [Locale('tr')],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          home: StatefulBuilder(
            builder: (context, setState) => Scaffold(
              body: ListView(
                key: PageStorageKey(tab),
                children: tab == 1
                    ? [
                        AgentPicker(
                          agents: const {'fatma': 'Fatma'},
                          selected: const {},
                          onChanged: (_, _) {},
                          onOpen: () {},
                        ),
                        const SizedBox(height: 1200),
                      ]
                    : [
                        CalendarPreview(
                          clock: const CalendarClock('Europe/Istanbul'),
                          calendar: calendar,
                          savedEvents: const [],
                          day: day,
                          onDateChanged: (value) => setState(() => day = value),
                          authorizationRevision: 0,
                        ),
                      ],
              ),
              bottomNavigationBar: TextButton(
                onPressed: () => setState(() => tab = tab == 1 ? 2 : 1),
                child: Text(tab == 1 ? 'Takvim' : 'Planla'),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.drag(find.byType(ListView).first, const Offset(0, -100));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Takvim'));
      await tester.pumpAndSettle();
      await tester.drag(find.byType(Card).first, const Offset(-200, 0));
      await tester.pumpAndSettle();
      expect(find.text('Aralık 2026'), findsOneWidget);
      await tester.tap(find.text('Planla'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.drag(find.byType(ListView).first, const Offset(0, 180));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Katılımcı seç'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Fatma'), findsOneWidget);
    },
  );

  testWidgets('participant selection stays in the checklist', (tester) async {
    final selected = <String>{};
    const agents = {'fatma': 'Fatma'};
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) => AgentPicker(
              agents: agents,
              selected: selected,
              onOpen: () {},
              onChanged: (id, checked) => setState(() {
                if (checked) {
                  selected.add(id);
                } else {
                  selected.remove(id);
                }
              }),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Katılımcı seç'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    expect(
      tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value,
      true,
    );
    await tester.tap(find.text('Katılımcı seç'));
    await tester.pumpAndSettle();
    expect(find.text('Fatma'), findsNothing);
    await tester.tap(find.text('Katılımcı seç'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value,
      true,
    );
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    expect(selected, isEmpty);
  });
}
