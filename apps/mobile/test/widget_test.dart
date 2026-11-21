import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meetmesh/agent/protocol.dart';
import 'package:meetmesh/app.dart';
import 'package:meetmesh/calendar/calendar.dart';
import 'package:meetmesh/calendar/calendar_clock.dart';
import 'package:meetmesh/calendar/calendar_preview.dart';
import 'package:meetmesh/calendar/meeting_window_fields.dart';

void main() {
  testWidgets('opens the app shell', (tester) async {
    await tester.pumpWidget(const MeetMeshApp());
    expect(find.text('MeetMesh'), findsOneWidget);
  });

  testWidgets('opens Turkish Material date and time pickers', (tester) async {
    const clock = CalendarClock('Europe/Istanbul');
    final start = DateTime.utc(2003, 1, 1, 18, 41);
    final end = start.add(const Duration(hours: 1));
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
            onChanged: (_) {},
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
    expect(find.byType(TimePickerDialog), findsOneWidget);
    expect(find.text('Başlangıç saati'), findsOneWidget);
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
            builder: (context, setState) => CalendarPreview(
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
    );
    await tester.pumpAndSettle();
    expect(find.text('Meşgul'), findsOneWidget);
    expect(find.text('10.11.2026 23:30 – 11.11.2026 00:30'), findsOneWidget);
    await tester.tap(find.text('11'));
    await tester.pumpAndSettle();
    expect(find.text('Meşgul'), findsNothing);
    expect(find.text('MeetMesh toplantısı'), findsOneWidget);
    await tester.tap(find.text('12'));
    await tester.pumpAndSettle();
    expect(find.text('Bu gün için etkinlik yok.'), findsOneWidget);
  });
}
