import 'package:flutter/material.dart';
import 'calendar_clock.dart';

class MeetingWindowFields extends StatelessWidget {
  final CalendarClock clock;
  final MeetingWindow? window;
  final ValueChanged<MeetingWindow>? onChanged;
  final bool futureOnly;

  const MeetingWindowFields({
    super.key,
    required this.clock,
    required this.window,
    required this.onChanged,
    required this.futureOnly,
  });

  Future<void> _pickDates(BuildContext context) async {
    final now = clock.day(DateTime.now());
    final first = futureOnly ? now : DateTime(1900);
    final last = DateTime(2100, 12, 31);
    final current = window;
    DateTimeRange? initial;
    if (current != null) {
      final start = clock.day(current.start), end = clock.day(current.end);
      if (!start.isBefore(first) &&
          !end.isAfter(last) &&
          !end.isBefore(start)) {
        initial = DateTimeRange(start: start, end: end);
      }
    }
    final selected = await showDateRangePicker(
      context: context,
      firstDate: first,
      lastDate: last,
      currentDate: now,
      initialDateRange: initial,
      helpText: 'Toplantı için tarih aralığı',
      saveText: 'Seç',
    );
    if (selected == null || !context.mounted) return;
    final startTime = current == null
        ? const TimeOfDay(hour: 10, minute: 0)
        : TimeOfDay.fromDateTime(clock.local(current.start));
    final endTime = current == null
        ? const TimeOfDay(hour: 16, minute: 0)
        : TimeOfDay.fromDateTime(clock.local(current.end));
    onChanged?.call((
      start: clock.at(selected.start, startTime),
      end: clock.at(selected.end, endTime),
    ));
  }

  Future<void> _pickTime(
    BuildContext context,
    MeetingWindow current, {
    required bool start,
  }) async {
    final instant = start ? current.start : current.end;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(clock.local(instant)),
      helpText: start ? 'Başlangıç saati' : 'Bitiş saati',
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (time == null || !context.mounted) return;
    final next = clock.at(clock.day(instant), time);
    onChanged?.call(
      start
          ? (start: next, end: current.end)
          : (start: current.start, end: next),
    );
  }

  @override
  Widget build(BuildContext context) {
    final current = window;
    final start = current == null ? null : clock.day(current.start);
    final end = current == null ? null : clock.day(current.end);
    return Card.outlined(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.date_range_outlined),
            title: const Text('Tarih aralığı'),
            subtitle: Text(
              start == null
                  ? 'Takvimden seç'
                  : DateUtils.isSameDay(start, end)
                  ? clock.dateLabel(start)
                  : '${clock.dateLabel(start)} – ${clock.dateLabel(end!)}',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: onChanged == null ? null : () => _pickDates(context),
          ),
          if (current != null)
            Row(
              children: [
                for (final isStart in [true, false])
                  Expanded(
                    child: ListTile(
                      title: Text(isStart ? 'Başlangıç' : 'Bitiş'),
                      subtitle: Text(
                        clock.timeLabel(isStart ? current.start : current.end),
                      ),
                      onTap: onChanged == null
                          ? null
                          : () => _pickTime(context, current, start: isStart),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
