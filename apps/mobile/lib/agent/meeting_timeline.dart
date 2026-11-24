import 'package:flutter/material.dart';
import '../calendar/calendar_clock.dart';
import 'protocol.dart';

class MeetingTimeline extends StatelessWidget {
  const MeetingTimeline({
    super.key,
    required this.moves,
    required this.agentLabel,
    required this.clock,
  });

  final List<Json> moves;
  final String Function(String) agentLabel;
  final CalendarClock clock;

  @override
  Widget build(BuildContext context) {
    if (moves.isEmpty) {
      return const ListTile(title: Text('Bu toplantı için hareket kaydı yok.'));
    }
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Toplantı akışı', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          for (final (index, move) in moves.reversed.indexed)
            _step(context, move, colors, index == 0, index == moves.length - 1),
        ],
      ),
    );
  }

  Widget _step(
    BuildContext context,
    Json move,
    ColorScheme colors,
    bool first,
    bool last,
  ) {
    final phase = move['phase'] ?? move['type'];
    final title = switch (phase) {
      'LOCAL_AVAILABILITY' => 'Takvimini kontrol etti',
      'LOCAL_OVERLAP_APPROVED' => 'Takvim çakışmasını onayladı',
      'REQUEST' => 'Toplantı isteği',
      'AVAILABILITY' => 'Müsaitlik yanıtı',
      'SELECTION' => 'Saat önerisi',
      'ACCEPT' => 'Onay',
      'REJECT' => 'Ret',
      'COMMIT' => 'Kesinleştirme kararı',
      'ABORT' => 'İptal kararı',
      'APPLIED' => 'Karar teyidi',
      'SYNC' => 'Durum sorgusu',
      'LOCAL_CALENDAR' => 'Takvime kaydetti',
      _ => 'Toplantı mesajı',
    };
    final actor = agentLabel(move['from']);
    final other = move['to'];
    final at = DateTime.tryParse(move['at'] as String? ?? '');
    final detail = [
      other is String ? '$actor → ${agentLabel(other)}' : actor,
      if (move['count'] case final int count) '$count uygun saat',
      if (move['slot'] case final Json slot)
        clock.range(DateTime.parse(slot['start']), DateTime.parse(slot['end'])),
      if (at != null)
        '${clock.dateLabel(clock.day(at))} ${clock.timeLabel(at)}',
    ];
    return Stack(
      children: [
        if (!first || !last)
          PositionedDirectional(
            start: 5,
            top: first ? 12 : 0,
            bottom: last ? null : 0,
            height: last ? 12 : null,
            child: Container(width: 2, color: colors.outlineVariant),
          ),
        PositionedDirectional(
          start: 0,
          top: 7,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: phase == 'ABORT' || phase == 'REJECT'
                  ? colors.error
                  : colors.primary,
              shape: BoxShape.circle,
            ),
            child: const SizedBox(width: 12, height: 12),
          ),
        ),
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(24, 2, 0, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleSmall),
              Text(
                detail.join(' · '),
                style: TextStyle(color: colors.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
