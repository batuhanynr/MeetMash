import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
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

const _phoneLab = bool.fromEnvironment('MEETMESH_PHONE_LAB');

class MobileRuntime extends ChangeNotifier {
  final vault = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  AccountConfig? config;
  Json? fixtureWindow;
  AgentConnection? connection;
  MeetingAgent? agent;
  CalendarAccount? google;
  http.Client? client;
  Timer? _tick;
  bool _working = false;
  bool _disposed = false;
  bool _foreground = true;
  int _connectionFailures = 0;
  DateTime? _retryConnectionAt;
  Future<void>? _starting;
  String? error;
  void _changed() {
    if (!_disposed) notifyListeners();
  }

  void setForeground(bool foreground) {
    _foreground = foreground;
    if (foreground) _retryConnectionAt = null;
  }

  Future<void> restore() async {
    try {
      final saved = await vault.read(key: 'identity');
      if (_disposed) return;
      if (saved != null) {
        final account = AccountConfig(jsonDecode(saved));
        if (configuredHub.isEmpty ||
            (account.provider == 'managed' && account.hub == configuredHub)) {
          await start(saved, restoring: true);
        }
      } else if (_phoneLab && configuredHub.isEmpty) {
        final directory = await getApplicationSupportDirectory();
        final account = File('${directory.path}/meetmesh-phone-account.json');
        if (await account.exists()) {
          final raw = await account.readAsString();
          if (!_disposed) await start(raw, restoring: true);
        }
      }
    } catch (_) {
      error = 'Hesap açılamadı. Bağlantı bilgilerini kontrol et.';
      _changed();
    }
  }

  Future<void> signIn(String email, String password) async {
    if (email.trim().isEmpty || password.isEmpty) {
      throw StateError('E-posta adresini ve MeetMesh şifreni gir.');
    }
    final account = await loginToHub(email, password);
    if (!_disposed) await start(account);
  }

  Future<void> signOut() async {
    await vault.delete(key: 'identity');
    _tick?.cancel();
    final conn = connection, a = agent, httpClient = client;
    connection = null;
    agent = null;
    config = null;
    fixtureWindow = null;
    google = null;
    client = null;
    _connectionFailures = 0;
    _retryConnectionAt = null;
    try {
      await conn?.close();
    } finally {
      await a?.idle;
      a?.store.close();
      httpClient?.close();
      error = null;
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
    final fixture = c.liveCalendar
        ? null
        : jsonDecode(
            await rootBundle.loadString(
              'packages/meetmesh_protocol/fixtures/calendar-v1.json',
            ),
          );
    if (!c.liveCalendar && fixture['agents'][c.id] == null) {
      throw StateError('Bu ajan için örnek takvim bulunamadı');
    }
    final wire = Wire(
      jsonDecode(
        await rootBundle.loadString(
          'packages/meetmesh_protocol/schemas/message.schema.json',
        ),
      ),
    );
    final dir = await getApplicationSupportDirectory();
    final root = c.provider == 'managed'
        ? 'managed/${sha256.convert(utf8.encode(jsonEncode([c.hub, c.ca])))}'
        : 'agents';
    final store = AgentStore(
      File('${dir.path}/$root/${c.id}/state.json'),
      c.id,
    );
    final conn = AgentConnection(c, _changed);
    late MeetingCalendar calendar;
    if (c.provider == 'managed') {
      calendar = GoogleCalendar.managed(conn.control);
    } else if (c.provider == 'google') {
      google = CalendarAccount(c.googleEmail!);
      client = http.Client();
      calendar = GoogleCalendar(client!, google!.token);
    } else {
      calendar = FixtureCalendar(fixture['agents'][c.id]);
    }
    final a = MeetingAgent(
      id: c.id,
      keys: c.keys,
      wire: wire,
      store: store,
      calendar: calendar,
      transmit: conn.send,
      canTransmit: () => conn.online && !conn.displaced,
      changed: _changed,
    );
    conn.agent = a;
    try {
      await conn.connect();
      if (!restoring) await vault.write(key: 'identity', value: raw);
    } catch (failure) {
      await conn.close();
      if (!restoring) {
        await a.idle;
        store.close();
        client?.close();
        google = null;
        client = null;
        rethrow;
      }
      error = _phoneLab
          ? 'Hub bağlantısı: $failure'
          : 'Çevrimdışısın. Son kayıtlı toplantıların gösteriliyor.';
    }
    if (_disposed) {
      await conn.close();
      await a.idle;
      store.close();
      client?.close();
      return;
    }
    config = c;
    fixtureWindow = fixture?['window'];
    connection = conn;
    agent = a;
    _tick = Timer.periodic(const Duration(milliseconds: 500), (_) async {
      if (_working || !_foreground || conn.displaced || connection != conn) {
        return;
      }
      _working = true;
      try {
        if (!conn.online) {
          if (_retryConnectionAt?.isAfter(DateTime.now()) ?? false) return;
          try {
            await reconnect();
          } catch (_) {
            if (connection != conn) return;
            final delay = 1 << _connectionFailures.clamp(0, 4);
            _retryConnectionAt = DateTime.now().add(Duration(seconds: delay));
            _connectionFailures++;
          }
          return;
        }
        await a.tick();
      } catch (_) {
        if (connection == conn) {
          error = 'İşlem yeniden denenecek';
          _changed();
        }
      } finally {
        _working = false;
      }
    });
    _changed();
  }

  Future<void> reconnect() async {
    final conn = connection;
    if (conn?.displaced == true) {
      throw StateError(
        'Oturum başka cihaza geçti. Uygulamayı yeniden açarak devralabilirsin.',
      );
    }
    if (conn != null && !conn.online) {
      await conn.connect();
      if (connection == conn && conn.online) {
        _connectionFailures = 0;
        _retryConnectionAt = null;
        error = null;
        _changed();
      }
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
