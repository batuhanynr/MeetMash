import 'package:flutter/material.dart';
import '../agent/meeting_title.dart';
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
  CalendarPreviewState createState() => CalendarPreviewState();
}

class CalendarPreviewState extends State<CalendarPreview> {
  Future<List<CalendarEntry>>? _events;
  double _monthDrag = 0;

  DateTime get _month => DateTime(widget.day.year, widget.day.month);
  DateTime get _monthStart => widget.clock.at(_month);
  DateTime get _monthEnd =>
      widget.clock.at(DateTime(_month.year, _month.month + 1));

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(CalendarPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    final changedMonth =
        widget.day.year != oldWidget.day.year ||
        widget.day.month != oldWidget.day.month;
    final force =
        widget.authorizationRevision != oldWidget.authorizationRevision ||
        widget.savedEvents.length != oldWidget.savedEvents.length;
    if (changedMonth ||
        widget.clock.zone != oldWidget.clock.zone ||
        widget.calendar != oldWidget.calendar ||
        force) {
      _load(force: force || widget.calendar != oldWidget.calendar);
    }
  }

  void _load({bool force = false}) {
    final provider = widget.calendar;
    _events =
        provider is GoogleCalendar &&
            (force ||
                provider.cachedEvents(
                      _monthStart,
                      _monthEnd,
                      widget.clock.zone,
                    ) ==
                    null)
        ? provider.refreshEvents(_monthStart, _monthEnd, widget.clock.zone)
        : null;
  }

  Future<void> refresh() async {
    setState(() => _load(force: true));
    try {
      await _events;
    } catch (_) {
      // The agenda displays the failure and any cached events.
    }
  }

  Iterable<CalendarEntry> _entriesOn(
    Iterable<CalendarEntry> entries,
    DateTime day,
  ) {
    final start = widget.clock.at(day);
    final end = widget.clock.at(DateUtils.addDaysToDate(day, 1));
    return entries.where((entry) {
      if (entry.allDay) {
        return !day.isBefore(DateUtils.dateOnly(entry.start)) &&
            day.isBefore(DateUtils.dateOnly(entry.end));
      }
      return entry.start.isBefore(end) && entry.end.isAfter(start);
    });
  }

  Widget _agenda(Iterable<CalendarEntry> entries) {
    final selected = _entriesOn(entries, widget.day).toList()
      ..sort((a, b) {
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

  Future<void> _chooseDate(DateTime today) async {
    final day = await showDatePicker(
      context: context,
      initialDate: widget.day,
      currentDate: today,
      firstDate: DateTime(1900),
      lastDate: DateTime(2100, 12, 31),
      initialDatePickerMode: DatePickerMode.year,
    );
    if (mounted && day != null) widget.onDateChanged(day);
  }

  void _moveMonth(int offset) {
    final month = DateTime(_month.year, _month.month + offset);
    if (month.year >= 1900 && month.year <= 2100) {
      widget.onDateChanged(month);
    }
  }

  Widget _monthGrid(BuildContext context, List<CalendarEntry> entries) {
    final local = MaterialLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final offset = DateUtils.firstDayOffset(_month.year, _month.month, local);
    final days = DateUtils.getDaysInMonth(_month.year, _month.month);
    final now = widget.clock.day(DateTime.now());
    final previous = DateTime(_month.year, _month.month - 1);
    final next = DateTime(_month.year, _month.month + 1);
    return Card.outlined(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton(
                  tooltip: local.previousMonthTooltip,
                  onPressed: previous.year < 1900 ? null : () => _moveMonth(-1),
                  icon: const Icon(Icons.chevron_left),
                ),
                Flexible(
                  child: TextButton(
                    onPressed: () => _chooseDate(now),
                    child: Text(local.formatMonthYear(_month)),
                  ),
                ),
                IconButton(
                  tooltip: local.nextMonthTooltip,
                  onPressed: next.year > 2100 ? null : () => _moveMonth(1),
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
            Row(
              children: [
                for (var i = 0; i < 7; i++)
                  Expanded(
                    child: Center(
                      child: Text(
                        local.narrowWeekdays[(local.firstDayOfWeekIndex + i) %
                            7],
                      ),
                    ),
                  ),
              ],
            ),
            for (var week = 0; week * 7 < days + offset; week++)
              Row(
                children: [
                  for (var weekday = 0; weekday < 7; weekday++)
                    Expanded(
                      child: _dayCell(
                        week * 7 + weekday - offset + 1,
                        days,
                        now,
                        entries,
                        colors,
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _dayCell(
    int number,
    int days,
    DateTime now,
    List<CalendarEntry> entries,
    ColorScheme colors,
  ) {
    if (number < 1 || number > days) return const SizedBox(height: 48);
    final day = DateTime(_month.year, _month.month, number);
    final count = _entriesOn(entries, day).length;
    final selected = DateUtils.isSameDay(day, widget.day);
    final today = DateUtils.isSameDay(day, now);
    return Semantics(
      button: true,
      selected: selected,
      label: '${widget.clock.dayLabel(day)}, $count etkinlik',
      onTap: () => widget.onDateChanged(day),
      child: ExcludeSemantics(
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () => widget.onDateChanged(day),
          child: Ink(
            decoration: BoxDecoration(
              color: selected ? colors.primaryContainer : null,
              border: today ? Border.all(color: colors.primary) : null,
              borderRadius: BorderRadius.circular(10),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '$number',
                    style: TextStyle(
                      color: selected ? colors.onPrimaryContainer : null,
                    ),
                  ),
                  if (count > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        color: colors.primary,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '$count',
                        style: TextStyle(fontSize: 10, color: colors.onPrimary),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = widget.calendar;
    return FutureBuilder<List<CalendarEntry>>(
      future: _events,
      builder: (context, snapshot) {
        final entries = switch (provider) {
          FixtureCalendar() => [
            for (final slot in (provider.profile['busy'] as List).cast<Json>())
              CalendarEntry.fromSlot('Meşgul', slot),
            for (final slot in widget.savedEvents)
              CalendarEntry.fromSlot(
                normalizeMeetingTitle(slot['title']),
                slot,
              ),
          ],
          GoogleCalendar() => provider.cachedEvents(
            _monthStart,
            _monthEnd,
            widget.clock.zone,
          ),
          _ => null,
        };
        final error = snapshot.connectionState == ConnectionState.done
            ? snapshot.error
            : null;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              excludeFromSemantics: true,
              onHorizontalDragStart: (_) => _monthDrag = 0,
              onHorizontalDragUpdate: (details) =>
                  _monthDrag += details.delta.dx,
              onHorizontalDragEnd: (_) {
                if (_monthDrag.abs() < 42) return;
                final forward = Directionality.of(context) == TextDirection.ltr
                    ? _monthDrag < 0
                    : _monthDrag > 0;
                _moveMonth(forward ? 1 : -1);
              },
              child: _monthGrid(context, entries ?? []),
            ),
            ListTile(
              title: Text(widget.clock.dayLabel(widget.day)),
              subtitle: Text(widget.clock.label),
            ),
            if (entries == null &&
                snapshot.connectionState == ConnectionState.waiting)
              const LinearProgressIndicator(
                semanticsLabel: 'Takvim yükleniyor',
              ),
            if (error != null)
              ListTile(
                title: Text(switch (error) {
                  CalendarAuthorizationRequired() => error.description,
                  CalendarSelectionRequired() => error.description,
                  _ => 'Etkinlikler yüklenemedi.',
                }),
                trailing: TextButton(
                  onPressed: refresh,
                  child: const Text('Tekrar dene'),
                ),
              ),
            if (entries != null) _agenda(entries),
          ],
        );
      },
    );
  }
}
