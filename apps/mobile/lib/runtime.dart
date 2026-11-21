import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:http/http.dart' as http;
import 'agent/connection.dart';
import 'agent/meeting_agent.dart';
import 'agent/protocol.dart';
import 'agent/store.dart';
import 'calendar/calendar.dart';
import 'calendar/google_account.dart';

class MobileRuntime extends ChangeNotifier {
  final vault = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  AccountConfig? config;
  AgentConnection? connection;
  MeetingAgent? agent;
  CalendarAccount? google;
  http.Client? client;
  Timer? _tick;
  bool _working = false;
  bool _disposed = false;
  Future<void>? _starting;
  String? error;
  void _changed() {
    if (!_disposed) notifyListeners();
  }

  Future<void> restore() async {
    try {
      final saved = await vault.read(key: 'identity');
      if (!_disposed && saved != null) await start(saved, restoring: true);
    } catch (_) {
      error = 'Hesap açılamadı. Bağlantı bilgilerini kontrol et.';
      _changed();
    }
  }

  Future<void> start(String raw, {bool restoring = false}) {
    return _starting ??= _start(raw, restoring).whenComplete(() {
      _starting = null;
    });
  }

  Future<void> _start(String raw, bool restoring) async {
    if (agent != null) {
      await reconnect();
      return;
    }
    final c = AccountConfig(jsonDecode(raw));
    final fixture = jsonDecode(
      await rootBundle.loadString(
        'packages/meetmesh_protocol/fixtures/calendar-v1.json',
      ),
    );
    final wire = Wire(
      jsonDecode(
        await rootBundle.loadString(
          'packages/meetmesh_protocol/schemas/message.schema.json',
        ),
      ),
    );
    final dir = await getApplicationSupportDirectory();
    final store = AgentStore(
      File('${dir.path}/agents/${c.id}/state.json'),
      c.id,
    );
    final conn = AgentConnection(c, _changed);
    late MeetingCalendar calendar;
    if (c.provider == 'google') {
      google = CalendarAccount(c.googleEmail!);
      client = http.Client();
      calendar = GoogleCalendar(client!, google!.token);
    } else {
      if (fixture['agents'][c.id] == null) {
        store.close();
        throw StateError('Bu ajan için örnek takvim bulunamadı');
      }
      calendar = FixtureCalendar(fixture['agents'][c.id]);
    }
    final a = MeetingAgent(
      id: c.id,
      keys: c.keys,
      wire: wire,
      store: store,
      calendar: calendar,
      transmit: conn.send,
      changed: _changed,
    );
    conn.agent = a;
    try {
      await conn.connect();
      if (!restoring) await vault.write(key: 'identity', value: raw);
    } catch (_) {
      await conn.close();
      if (!restoring) {
        store.close();
        client?.close();
        rethrow;
      }
      error = 'Çevrimdışısın. Son kayıtlı toplantıların gösteriliyor.';
    }
    if (_disposed) {
      await conn.close();
      await a.idle;
      store.close();
      client?.close();
      return;
    }
    config = c;
    connection = conn;
    agent = a;
    _tick = Timer.periodic(const Duration(milliseconds: 500), (_) async {
      if (_working || !conn.online) return;
      _working = true;
      try {
        await a.tick();
      } catch (_) {
        error = 'İşlem yeniden denenecek';
        _changed();
      } finally {
        _working = false;
      }
    });
    _changed();
  }

  Future<void> reconnect() async {
    if (connection?.displaced == true) {
      throw StateError(
        'Oturum başka cihaza geçti. Uygulamayı yeniden açarak devralabilirsin.',
      );
    }
    if (connection != null && connection!.online == false) {
      await connection!.connect();
      error = null;
      _changed();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _tick?.cancel();
    final conn = connection;
    final a = agent;
    if (conn != null && a != null) {
      unawaited(
        conn.close().then((_) => a.idle).then((_) {
          a.store.close();
          client?.close();
        }),
      );
    }
    super.dispose();
  }
}
