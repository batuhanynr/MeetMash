import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:timezone/data/latest.dart' as data;
import 'package:timezone/timezone.dart' as tz;

final _istanbul = (() {
  data.initializeTimeZones();
  return tz.getLocation('Europe/Istanbul');
})();

typedef MeetingWindow = ({DateTime start, DateTime end});

class CalendarClock {
  final String zone;
  const CalendarClock(this.zone);

  tz.Location get _location => zone == 'UTC' ? tz.UTC : _istanbul;
  String get label => zone == 'UTC' ? 'UTC' : 'İstanbul saati';
  tz.TZDateTime local(DateTime instant) =>
      tz.TZDateTime.from(instant, _location);
  DateTime day(DateTime instant) => DateUtils.dateOnly(local(instant));
  DateTime at(
    DateTime day, [
    TimeOfDay time = const TimeOfDay(hour: 0, minute: 0),
  ]) => tz.TZDateTime(
    _location,
    day.year,
    day.month,
    day.day,
    time.hour,
    time.minute,
  ).toUtc();

  static final _day = DateFormat('dd.MM.yyyy', 'tr');
  static final _weekday = DateFormat('EEEE, dd.MM.yyyy', 'tr');
  static final _time = DateFormat('HH:mm', 'tr');
  String dateLabel(DateTime date) => _day.format(date);
  String dayLabel(DateTime date) => _weekday.format(date);
  String timeLabel(DateTime instant) => _time.format(local(instant));

  String range(DateTime start, DateTime end) {
    final from = local(start), to = local(end);
    final endDate = DateUtils.isSameDay(from, to) ? '' : '${dateLabel(to)} ';
    return '${dateLabel(from)} ${_time.format(from)} – $endDate${_time.format(to)}';
  }
}
