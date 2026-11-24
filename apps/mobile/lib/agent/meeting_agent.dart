import 'dart:async';
import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'meeting_title.dart';
import 'protocol.dart';
import 'store.dart';
import '../calendar/calendar.dart';

class CalendarOverlapNeedsApproval implements Exception {
  const CalendarOverlapNeedsApproval();
}

class MeetingAgent {
  final String id;
  final Map<String, String> keys;
  final Wire wire;
  final AgentStore store;
  final MeetingCalendar calendar;
  final bool automatic;
  final void Function(Json) transmit;
  final bool Function()? canTransmit;
  final void Function() changed;
  final DateTime Function() now;
  Future<void> _tail = Future.value();
  MeetingAgent({
    required this.id,
    required this.keys,
    required this.wire,
    required this.store,
    required this.calendar,
    required this.transmit,
    this.canTransmit,
    required this.changed,
    this.automatic = false,
    DateTime Function()? clock,
  }) : now = clock ?? DateTime.now;
  Future<T> _serial<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Future<void> get idle => _tail;
  void _save(Json s) {
    store.commit(s);
    changed();
  }

  Json _envelope(
    Json s,
    String to,
    String meeting,
    String type,
    Json payload, [
    Json? m,
  ]) {
    final key = keys[pair(id, to)];
    if (key == null) throw StateError('Missing peer key for $to');
    final seqKey = jsonEncode([to, meeting]);
    final seq = (s['sequences'][seqKey] ?? 0) + 1;
    final t = now();
    final msg = <String, dynamic>{
      'protocolVersion': '1',
      'messageId': newId(),
      'meetingId': meeting,
      'fromAgentId': id,
      'toAgentId': to,
      'type': type,
      'sequence': seq,
      'createdAt': utc(t),
      'expiresAt': utc(t.add(const Duration(minutes: 3))),
      'nonce': newId(),
      'payload': payload,
      if (m != null) 'roundId': m['roundId'],
      if (m != null) 'decisionVersion': m['decisionVersion'],
      'auth': <String, dynamic>{},
    };
    msg['auth'] = {'keyId': pair(id, to), 'mac': mac(msg, key)};
    wire.validate(msg);
    s['sequences'][seqKey] = seq;
    return msg;
  }

  String _queue(Json s, Json m, String to, String type, Json payload) {
    final msg = _envelope(s, to, m['meetingId'], type, payload, m);
    _recordMove(m, msg);
    s['outbox'][msg['messageId']] = {'message': msg, 'next': 0, 'attempts': 0};
    return msg['messageId'];
  }

  void _recordMove(Json meeting, Json message) {
    final payload = message['payload'] as Json? ?? const {};
    final move = <String, dynamic>{
      'at': message['createdAt'] ?? utc(now()),
      'from': message['fromAgentId'],
      'to': message['toAgentId'],
      'type': message['type'],
      if (payload['phase'] case final String phase) 'phase': phase,
      if (payload['slots'] case final List slots) 'count': slots.length,
      if (payload['slot'] case final Json slot) 'slot': times(slot),
      if (payload['reasonCode'] case final String reason) 'reason': reason,
    };
    final moves = (meeting['moves'] ??= <Json>[]) as List;
    // Protocol retries describe the same move, even with a new envelope ID.
    bool sameMove(Json previous) =>
        previous['from'] == move['from'] &&
        previous['to'] == move['to'] &&
        previous['type'] == move['type'] &&
        previous['phase'] == move['phase'] &&
        previous['reason'] == move['reason'] &&
        canonical(previous['slot']) == canonical(move['slot']);
    if (moves.cast<Json>().any(sameMove)) return;
    moves.add(move);
    if (moves.length > 256) moves.removeAt(0);
  }

  void _flush() {
    if (canTransmit?.call() == false) return;
    final s = store.copy();
    final due = <Json>[];
    final t = now().millisecondsSinceEpoch;
    for (final row in (s['outbox'] as Map).values) {
      if (row['custody'] == true ||
          row['exhausted'] == true ||
          row['next'] > t) {
        continue;
      }
      final msg = row['message'];
      if (DateTime.parse(msg['expiresAt']).millisecondsSinceEpoch <= t ||
          row['attempts'] >= 6) {
        row['exhausted'] = true;
        continue;
      }
      row['next'] = t + (1000 << (row['attempts'] as int).clamp(0, 3));
      row['attempts']++;
      due.add(msg);
    }
    if (due.isNotEmpty ||
        canonical(s['outbox']) != canonical(store.data['outbox'])) {
      _save(s);
    }
    for (final msg in due) {
      transmit(msg);
    }
  }

  Future<void> relay(String messageId) => _serial(() async {
    final s = store.copy();
    final row = s['outbox'][messageId];
    if (row != null && row['custody'] != true) {
      row['custody'] = true;
      _save(s);
    }
  });
  List<Json> _reserved(Json s, String except) => [
    for (final m in (s['meetings'] as Map).values)
      if (m['meetingId'] != except && m['held'] == true) m['selected'],
    for (final e in (s['events'] as Map).entries)
      if (e.key != except) e.value,
  ];
  Json _new(
    String meeting,
    String coordinator,
    List participants,
    Json window,
    int duration,
    String round,
    int version,
    String deadline,
    String title,
  ) => {
    'meetingId': meeting,
    'coordinator': coordinator,
    'title': title,
    'participants': participants,
    'window': window,
    'duration': duration,
    'roundId': round,
    'decisionVersion': version,
    'deadline': deadline,
    'status': 'COLLECTING',
    'offers': {},
    'accepts': {},
    'selectionIds': {},
    'applied': {},
  };
  Future<String> schedule(
    List<String> participants,
    Json window,
    int duration, {
    Duration timeout = const Duration(seconds: 120),
    String? meetingId,
    String? title,
    bool allowCalendarOverlap = false,
  }) => _serial(() async {
    validateWindow(window, duration);
    final peers = {id, ...participants}.toList()..sort();
    if (peers.length < 2 ||
        peers
            .where((p) => p != id)
            .any((p) => !keys.containsKey(pair(id, p)))) {
      throw StateError('Choose provisioned participants');
    }
    final s = store.copy();
    final meeting = meetingId ?? newId();
    if (s['meetings'].containsKey(meeting)) {
      throw StateError('Meeting already exists');
    }
    final reserved = _reserved(s, meeting);
    var slots = await calendar.candidates(window, duration, reserved);
    var calendarOverlapApproved = false;
    if (slots.isEmpty) {
      slots = await calendar.candidates(
        window,
        duration,
        reserved,
        allowCalendarOverlap: true,
      );
      if (slots.isEmpty) {
        throw StateError('Bu aralıkta toplantı için uygun bir saat yok.');
      }
      if (!allowCalendarOverlap) throw const CalendarOverlapNeedsApproval();
      calendarOverlapApproved = true;
    }
    final m = _new(
      meeting,
      id,
      peers,
      window,
      duration,
      newId(),
      1,
      utc(now().add(timeout)),
      normalizeMeetingTitle(title),
    );
    if (calendarOverlapApproved) m['calendarOverlapApproved'] = true;
    m['offers'][id] = slots;
    s['meetings'][meeting] = m;
    _recordMove(m, {
      'fromAgentId': id,
      'type': calendarOverlapApproved
          ? 'LOCAL_OVERLAP_APPROVED'
          : 'LOCAL_AVAILABILITY',
      'payload': {'slots': m['offers'][id]},
    });
    for (final to in peers.where((p) => p != id)) {
      _queue(s, m, to, 'REQUEST', {
        'participantAgentIds': peers,
        'durationMinutes': duration,
        'window': window,
        'deadline': m['deadline'],
        'title': m['title'],
      });
    }
    _save(s);
    _flush();
    return meeting;
  });
  Future<void> receive(Json msg) => _serial(() async {
    wire.validate(msg);
    final key = keys[pair(id, msg['fromAgentId'])];
    if (msg['toAgentId'] != id ||
        key == null ||
        !sameMac(mac(msg, key), msg['auth']['mac'] ?? '')) {
      throw const FormatException('Invalid peer or MAC');
    }
    final s = store.copy();
    final mid = msg['messageId'] as String;
    if (msg['type'] == 'ACK') {
      final ack = msg['payload'];
      final sent = s['outbox'][ack['ackForMessageId']]?['message'];
      if (sent != null &&
          sent['toAgentId'] == msg['fromAgentId'] &&
          sent['meetingId'] == msg['meetingId'] &&
          ack['scope'] == 'recipient.persisted') {
        s['outbox'].remove(ack['ackForMessageId']);
        _save(s);
      }
      return;
    }
    final digest = sha256.convert(utf8.encode(signedBytes(msg))).toString();
    if (s['inbox'][mid] != null && s['inbox'][mid]['digest'] != digest ||
        s['nonces'][msg['nonce']] != null &&
            s['nonces'][msg['nonce']] != digest) {
      throw const FormatException('Conflicting replay');
    }
    if (s['inbox'][mid] == null) {
      if (!DateTime.parse(msg['expiresAt']).isAfter(now())) {
        throw const FormatException('Expired');
      }
      s['nonces'][msg['nonce']] = digest;
      s['inbox'][mid] = {'digest': digest, 'pending': msg};
    }
    final ack = _envelope(s, msg['fromAgentId'], msg['meetingId'], 'ACK', {
      'ackForMessageId': mid,
      'scope': 'recipient.persisted',
    });
    _save(s);
    transmit(ack);
    await _work(mid);
  });
  Future<void> _work(String mid) async {
    final s = store.copy();
    final msg = s['inbox'][mid]?['pending'];
    if (msg == null) return;
    if (msg['roundId'] != null) await _advance(s, msg);
    s['inbox'][mid].remove('pending');
    _save(s);
    _flush();
  }

  Future<void> _advance(Json s, Json msg) async {
    final meeting = msg['meetingId'],
        peer = msg['fromAgentId'],
        p = msg['payload'];
    Json? m = s['meetings'][meeting];
    if (msg['type'] == 'REQUEST' && m == null) {
      if (p['deadline'] is! String ||
          !(p['participantAgentIds'] as List).contains(peer) ||
          !(p['participantAgentIds'] as List).contains(id) ||
          !DateTime.parse(p['deadline']).isAfter(now())) {
        return;
      }
      m = _new(
        meeting,
        peer,
        p['participantAgentIds'],
        p['window'],
        p['durationMinutes'],
        msg['roundId'],
        msg['decisionVersion'],
        p['deadline'],
        normalizeMeetingTitle(p['title']),
      );
      s['meetings'][meeting] = m;
      _recordMove(m, msg);
      try {
        validateWindow(m['window'], m['duration']);
        m['offers'][id] = await calendar.candidates(
          m['window'],
          m['duration'],
          _reserved(s, meeting),
        );
      } on CalendarAuthorizationRequired {
        m['status'] = 'DECLINED';
        m['error'] = CalendarAuthorizationRequired.message;
        _queue(s, m, peer, 'REJECT', {'reasonCode': 'DECLINED'});
        return;
      } on FormatException {
        m['status'] = 'DECLINED';
        _queue(s, m, peer, 'REJECT', {'reasonCode': 'INVALID_REQUEST'});
        return;
      }
      _queue(s, m, peer, 'PROPOSE', {
        'phase': 'AVAILABILITY',
        'slots': m['offers'][id],
      });
      return;
    }
    if (m == null ||
        m['roundId'] != msg['roundId'] ||
        m['decisionVersion'] != msg['decisionVersion'] ||
        !(m['participants'] as List).contains(peer) ||
        (m['coordinator'] != id && peer != m['coordinator'])) {
      return;
    }
    _recordMove(m, msg);
    if (m['coordinator'] == id) {
      if (m['decision'] == null &&
          !DateTime.parse(m['deadline']).isAfter(now())) {
        _decide(s, m, false, 'TIMEOUT');
      }
      if (msg['type'] == 'PROPOSE' &&
          p['phase'] == 'AVAILABILITY' &&
          m['status'] == 'COLLECTING') {
        if (!(p['slots'] as List).every((v) => v['score'] is int) ||
            m['offers'].containsKey(peer)) {
          return;
        }
        m['offers'][peer] = p['slots'];
        if ((m['offers'] as Map).length != m['participants'].length) return;
        final ranked = rank(m['participants'], m['offers']);
        m['ranked'] = ranked;
        if (ranked.isEmpty) {
          _decide(s, m, false, 'NO_COMMON_SLOT');
          return;
        }
        m['selected'] = times(ranked.first);
        final available = await _available(s, m);
        if (!DateTime.parse(m['deadline']).isAfter(now())) {
          _decide(s, m, false, 'TIMEOUT');
          return;
        }
        if (!available) {
          m['error'] = 'Önerilen saat artık takviminde müsait değil.';
          _decide(s, m, false, 'DECLINED');
          return;
        }
        m['held'] = true;
        m['accepts'][id] = true;
        m['status'] = 'AWAITING_ACCEPT';
        for (final to in m['participants']) {
          if (to != id) {
            m['selectionIds'][to] = _queue(s, m, to, 'PROPOSE', {
              'phase': 'SELECTION',
              'slot': m['selected'],
            });
          }
        }
      } else if (msg['type'] == 'ACCEPT' &&
          m['status'] == 'AWAITING_ACCEPT' &&
          m['selectionIds'][peer] == p['proposalMessageId']) {
        m['accepts'][peer] = true;
        if (m['participants'].every((v) => m!['accepts'][v] == true)) {
          _decide(s, m, true, '');
        }
      } else if (msg['type'] == 'REJECT' && m['decision'] == null) {
        _decide(
          s,
          m,
          false,
          p['reasonCode'] == 'NO_AVAILABILITY'
              ? 'NO_COMMON_SLOT'
              : p['reasonCode'],
        );
      } else if (msg['type'] == 'CONFIRM' &&
          p['phase'] == 'APPLIED' &&
          m['decision'] == 'COMMIT' &&
          p['decisionId'] == m['decisionId']) {
        m['applied'][peer] = true;
        _finish(m);
      } else if (msg['type'] == 'CONFIRM' &&
          p['phase'] == 'SYNC' &&
          m['decision'] != null) {
        _decisionTo(s, m, peer);
      }
      return;
    }
    if (msg['type'] == 'REQUEST' && m['status'] == 'COLLECTING') {
      _queue(s, m, peer, 'PROPOSE', {
        'phase': 'AVAILABILITY',
        'slots': m['offers'][id],
      });
      return;
    }
    if (msg['type'] == 'PROPOSE' &&
        p['phase'] == 'SELECTION' &&
        m['status'] == 'PENDING_RECOVERY' &&
        sameSlot(m['selected'], p['slot'])) {
      _queue(s, m, peer, 'ACCEPT', {'proposalMessageId': msg['messageId']});
      return;
    }
    if (msg['type'] == 'PROPOSE' &&
        p['phase'] == 'SELECTION' &&
        m['status'] == 'COLLECTING') {
      m['selected'] = times(p['slot']);
      m['selectionId'] = msg['messageId'];
      m['status'] = 'AWAITING_USER';
      if (automatic) await _vote(s, m, true);
    } else if (msg['type'] == 'CONFIRM' &&
        p['phase'] == 'ABORT' &&
        m['decision'] != 'COMMIT' &&
        (m['decisionId'] == null || m['decisionId'] == p['decisionId'])) {
      m['decision'] = 'ABORT';
      m['decisionId'] = p['decisionId'];
      m['status'] = 'ABORTED';
      m['held'] = false;
      m['reason'] = p['reasonCode'];
      _queue(s, m, peer, 'CONFIRM', {
        'phase': 'APPLIED',
        'decisionId': m['decisionId'],
      });
    } else if (msg['type'] == 'CONFIRM' &&
        p['phase'] == 'COMMIT' &&
        m['decision'] != 'ABORT' &&
        (m['decisionId'] == null || m['decisionId'] == p['decisionId']) &&
        (m['held'] == true || m['applied'][id] == true) &&
        sameSlot(p['slot'], m['selected'])) {
      m['decision'] = 'COMMIT';
      m['decisionId'] = p['decisionId'];
      if (m['applied'][id] == true) {
        _queue(s, m, peer, 'CONFIRM', {
          'phase': 'APPLIED',
          'decisionId': m['decisionId'],
        });
      } else {
        m['status'] = 'COMMIT_PENDING';
      }
    }
  }

  Future<bool> _available(Json s, Json m) async {
    final slots = await calendar.candidates(
      m['window'],
      m['duration'],
      _reserved(s, m['meetingId']),
      allowCalendarOverlap:
          m['coordinator'] == id && m['calendarOverlapApproved'] == true,
    );
    return slots.any((slot) => sameSlot(slot, m['selected']));
  }

  Future<void> _vote(Json s, Json m, bool yes) async {
    if (m['status'] != 'AWAITING_USER') return;
    final deadline = DateTime.parse(m['deadline']);
    final available = yes && deadline.isAfter(now()) && await _available(s, m);
    if (available && deadline.isAfter(now())) {
      m['held'] = true;
      m['status'] = 'PENDING_RECOVERY';
      _queue(s, m, m['coordinator'], 'ACCEPT', {
        'proposalMessageId': m['selectionId'],
      });
    } else {
      m['status'] = 'DECLINED';
      if (yes) {
        m['error'] = deadline.isAfter(now())
            ? 'Önerilen saat artık müsait değil.'
            : 'Onay süresi doldu.';
      }
      _queue(s, m, m['coordinator'], 'REJECT', {'reasonCode': 'DECLINED'});
    }
  }

  Future<void> vote(String meeting, bool yes) => _serial(() async {
    final s = store.copy();
    final Json? proposal = s['meetings'][meeting];
    if (proposal == null || proposal['status'] != 'AWAITING_USER') {
      throw StateError('Bu toplantıda bekleyen bir onay yok.');
    }
    await _vote(s, proposal, yes);
    _save(s);
    _flush();
  });
  void _decisionTo(Json s, Json m, String to) {
    _queue(s, m, to, 'CONFIRM', {
      'phase': m['decision'],
      'decisionId': m['decisionId'],
      if (m['decision'] == 'COMMIT') 'slot': m['selected'],
      if (m['decision'] == 'ABORT') 'reasonCode': m['reason'],
    });
  }

  void _decide(Json s, Json m, bool commit, String reason) {
    if (m['decision'] != null) return;
    m['decision'] = commit ? 'COMMIT' : 'ABORT';
    m['decisionId'] = newId();
    m['reason'] = reason;
    m['status'] = commit ? 'COMMIT_PENDING' : 'ABORTED';
    if (!commit) m['held'] = false;
    for (final to in m['participants']) {
      if (to != id) _decisionTo(s, m, to);
    }
  }

  void _finish(Json m) {
    if ((m['participants'] as List).every((p) => m['applied'][p] == true)) {
      m['status'] = 'CONFIRMED';
    }
  }

  Future<void> retryCalendarWrites() => _serial(() async {
    final s = store.copy();
    var changed = false;
    for (final Json m in (s['meetings'] as Map).values) {
      if (m['status'] == 'COMMIT_PENDING' && m['applied'][id] != true) {
        m.remove('retryWriteAt');
        m.remove('writeAttempts');
        changed = true;
      }
    }
    if (changed) _save(s);
  });

  Future<void> tick() => _serial(() async {
    for (final e
        in (store.data['inbox'] as Map).entries
            .where((e) => e.value['pending'] != null)
            .toList()) {
      try {
        await _work(e.key);
      } catch (_) {
        /* Calendar read will retry on the next tick. */
      }
    }
    final s = store.copy();
    for (final Json m in (s['meetings'] as Map).values) {
      if (m['decision'] == null &&
          m['coordinator'] == id &&
          !DateTime.parse(m['deadline']).isAfter(now())) {
        _decide(s, m, false, 'TIMEOUT');
      }
      final t = now().millisecondsSinceEpoch;
      if (m['decision'] == 'COMMIT' &&
          m['applied'][id] != true &&
          (m['retryWriteAt'] ?? 0) <= t) {
        try {
          final title = normalizeMeetingTitle(m['title']);
          await calendar.ensureEvent(
            m['meetingId'],
            id,
            m['selected'],
            title: title,
          );
          s['events'][m['meetingId']] = {
            ...m['selected'] as Json,
            'title': title,
          };
          m['held'] = false;
          m['applied'][id] = true;
          _recordMove(m, {'fromAgentId': id, 'type': 'LOCAL_CALENDAR'});
          m.remove('error');
          m.remove('retryWriteAt');
          m.remove('writeAttempts');
          if (m['coordinator'] == id) {
            _finish(m);
          } else {
            m['status'] = 'APPLIED';
            _queue(s, m, m['coordinator'], 'CONFIRM', {
              'phase': 'APPLIED',
              'decisionId': m['decisionId'],
            });
          }
        } catch (e) {
          m['error'] = e is CalendarAuthorizationRequired
              ? CalendarAuthorizationRequired.message
              : 'Takvime yazılamadı. Tekrar denenecek.';
          final attempts = (m['writeAttempts'] as int? ?? 0) + 1;
          m['writeAttempts'] = attempts;
          m['retryWriteAt'] = t + 1000 * (1 << (attempts > 6 ? 6 : attempts));
        }
      }
      if ((m['syncAfter'] ?? 0) > t) continue;
      if (m['status'] == 'PENDING_RECOVERY') {
        _queue(s, m, m['coordinator'], 'CONFIRM', {'phase': 'SYNC'});
        m['syncAfter'] = t + 5000;
      } else if (m['status'] == 'COMMIT_PENDING' && m['coordinator'] == id) {
        for (final peer in m['participants']) {
          if (peer != id && m['applied'][peer] != true) _decisionTo(s, m, peer);
        }
        m['syncAfter'] = t + 5000;
      }
    }
    if (canonical(s) != canonical(store.data)) _save(s);
    _flush();
  });
}
