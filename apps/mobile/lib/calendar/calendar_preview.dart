import 'package:flutter/material.dart';
import '../agent/protocol.dart';
import 'calendar.dart';
import 'calendar_clock.dart';

class CalendarPreview extends StatefulWidget {
  final CalendarClock clock;
  final MeetingCalendar calendar;
  final Iterable<Json> savedEvents;
  final DateTime day;
  final ValueChanged<DateTime> onDateChanged;
  final int authorizationRevision;

  const CalendarPreview({
    super.key,
    required this.clock,
    required this.calendar,
    required this.savedEvents,
    required this.day,
    required this.onDateChanged,
    required this.authorizationRevision,
  });

  @override
  State<CalendarPreview> createState() => _CalendarPreviewState();
}

class _CalendarPreviewState extends State<CalendarPreview> {
  Future<List<CalendarEntry>>? _events;

  DateTime get _start => widget.clock.at(widget.day);
  DateTime get _end => widget.clock.at(
    DateTime(widget.day.year, widget.day.month, widget.day.day + 1),
  );

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void didUpdateWidget(CalendarPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.day != oldWidget.day ||
        widget.clock.zone != oldWidget.clock.zone ||
        widget.calendar != oldWidget.calendar ||
        widget.authorizationRevision != oldWidget.authorizationRevision ||
        widget.savedEvents.length != oldWidget.savedEvents.length) {
      _refresh();
    }
  }

  void _refresh() {
    final provider = widget.calendar;
    _events = provider is GoogleCalendar
        ? provider.eventsOn(_start, _end, widget.clock.zone)
        : null;
  }

  Widget _agenda(Iterable<CalendarEntry> entries) {
    final start = _start, end = _end;
    final selected =
        entries.where((e) {
          if (e.allDay) {
            return !widget.day.isBefore(DateUtils.dateOnly(e.start)) &&
                widget.day.isBefore(DateUtils.dateOnly(e.end));
          }
          return e.start.isBefore(end) && e.end.isAfter(start);
        }).toList()..sort((a, b) {
          if (a.allDay != b.allDay) return a.allDay ? -1 : 1;
          return a.start.compareTo(b.start);
        });
    return Card.outlined(
      child: Column(
        children: [
          if (selected.isEmpty)
            const ListTile(title: Text('Bu gün için etkinlik yok.')),
          for (final e in selected)
            ListTile(
              leading: Icon(e.allDay ? Icons.today_outlined : Icons.schedule),
              title: Text(e.title),
              subtitle: Text(
                e.allDay ? 'Tüm gün' : widget.clock.range(e.start, e.end),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fixture = widget.calendar;
    final now = widget.clock.day(DateTime.now());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card.outlined(
          child: CalendarDatePicker(
            initialDate: widget.day,
            firstDate: DateTime(1900),
            lastDate: DateTime(2100, 12, 31),
            currentDate: now,
            onDateChanged: widget.onDateChanged,
          ),
        ),
        ListTile(
          title: Text(widget.clock.dayLabel(widget.day)),
          subtitle: Text(widget.clock.label),
        ),
        if (fixture is FixtureCalendar)
          _agenda([
            for (final slot in (fixture.profile['busy'] as List).cast<Json>())
              CalendarEntry.fromSlot('Meşgul', slot),
            for (final slot in widget.savedEvents)
              CalendarEntry.fromSlot('MeetMesh toplantısı', slot),
          ])
        else
          FutureBuilder<List<CalendarEntry>>(
            future: _events,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LinearProgressIndicator(
                  semanticsLabel: 'Takvim yükleniyor',
                );
              }
              if (snapshot.error case CalendarAuthorizationRequired error) {
                return ListTile(title: Text(error.description));
              }
              if (snapshot.hasError) {
                return ListTile(
                  title: const Text('Etkinlikler yüklenemedi.'),
                  trailing: TextButton(
                    onPressed: () => setState(_refresh),
                    child: const Text('Tekrar dene'),
                  ),
                );
              }
              return _agenda(snapshot.data ?? []);
            },
          ),
      ],
    );
  }
}
