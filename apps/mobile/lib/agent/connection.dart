import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'protocol.dart';
import 'meeting_agent.dart';

class AccountConfig {
  final String id, secret, hub, ca, provider;
  final String? googleEmail;
  final Map<String, String> keys;
  AccountConfig(Json data)
    : id = data['agentId'],
      secret = data['secret'],
      hub = data['hub'],
      ca = data['caPem'],
      provider = data['calendar'] ?? 'fixture',
      googleEmail = data['googleEmail'],
      keys = Map<String, String>.from(data['pairKeys']) {
    final url = Uri.tryParse(hub);
    if (!RegExp(r'^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$').hasMatch(id) ||
        secret.isEmpty ||
        keys.isEmpty ||
        url == null ||
        url.scheme != 'wss' ||
        url.host.isEmpty ||
        url.userInfo.isNotEmpty ||
        url.hasFragment ||
        !['google', 'fixture'].contains(provider) ||
        (provider == 'google' && (googleEmail ?? '').isEmpty) ||
        keys.entries.any(
          (e) => !e.key.split(':').contains(id) || e.value.isEmpty,
        )) {
      throw const FormatException('Invalid account configuration');
    }
  }
}

class AgentConnection {
  final AccountConfig account;
  final void Function() changed;
  late MeetingAgent agent;
  WebSocket? _socket;
  HttpClient? _client;
  Future<void>? _connecting;
  Timer? _heartbeat;
  bool online = false, displaced = false;
  String? lastError;
  final pending = <String, Completer<Json>>{};
  AgentConnection(this.account, this.changed);
  void send(Json value) {
    if (online) _socket?.add(jsonEncode(value));
  }

  Future<void> connect() => _connecting ??= _connect().whenComplete(() {
    _connecting = null;
  });

  Future<void> _connect() async {
    if (_socket != null || displaced) return;
    final ctx = SecurityContext(withTrustedRoots: false)
      ..setTrustedCertificatesBytes(utf8.encode(account.ca));
    final client = HttpClient(context: ctx)
      ..connectionTimeout = const Duration(seconds: 8);
    _client = client;
    late final WebSocket socket;
    try {
      socket = await WebSocket.connect(
        account.hub,
        customClient: client,
        headers: {
          'x-meetmesh-agent': account.id,
          'x-meetmesh-secret': account.secret,
        },
      ).timeout(const Duration(seconds: 10));
    } catch (_) {
      client.close(force: true);
      rethrow;
    }
    if (_client != client) {
      await socket.close();
      return;
    }
    _socket = socket;
    socket.pingInterval = const Duration(seconds: 10);
    final ready = Completer<void>();
    void end() {
      if (_socket != socket) return;
      _socket = null;
      online = false;
      _heartbeat?.cancel();
      client.close(force: true);
      for (final p in pending.values) {
        if (!p.isCompleted) p.completeError(StateError('Disconnected'));
      }
      pending.clear();
      if (!ready.isCompleted) {
        ready.completeError(StateError(lastError ?? 'Connection refused'));
      }
      changed();
    }

    socket.listen(
      (raw) async {
        if (_socket != socket || displaced) return;
        try {
          final frame = jsonDecode(raw as String) as Json;
          switch (frame['kind']) {
            case 'ready':
              online = true;
              lastError = null;
              if (!ready.isCompleted) ready.complete();
              changed();
              break;
            case 'displaced':
              displaced = true;
              online = false;
              lastError = 'Oturum başka cihaza geçti.';
              changed();
              await socket.close();
              break;
            case 'relay.ack':
              await agent.relay(frame['messageId']);
              break;
            case 'error':
              lastError = frame['code'];
              final request = pending.remove(frame['requestId']);
              if (request != null && !request.isCompleted) {
                request.completeError(StateError(lastError ?? 'Hub request failed'));
              }
              changed();
              break;
            case null:
              await agent.receive(frame);
              break;
            default:
              pending.remove(frame['requestId'])?.complete(frame);
          }
        } catch (e) {
          lastError = 'Unable to process message';
          changed();
        }
      },
      onDone: end,
      onError: (Object e) {
        lastError = 'Hub connection failed';
        end();
      },
    );
    try {
      await ready.future.timeout(const Duration(seconds: 8));
    } catch (_) {
      await socket.close();
      end();
      rethrow;
    }
    _heartbeat = Timer.periodic(
      const Duration(seconds: 4),
      (_) => send({'kind': 'heartbeat'}),
    );
  }

  Future<Json> control(Json frame) async {
    if (!online) throw StateError('Connect to the hub first');
    final requestId = newId();
    final c = Completer<Json>();
    pending[requestId] = c;
    try {
      send({...frame, 'requestId': requestId});
      final res = await c.future.timeout(const Duration(seconds: 65));
      if (res['error'] != null) throw StateError(res['error']);
      return res;
    } finally {
      pending.remove(requestId);
    }
  }

  Future<void> close() async {
    _heartbeat?.cancel();
    final client = _client;
    _client = null;
    try {
      await _socket?.close().timeout(const Duration(seconds: 2));
    } on TimeoutException {
      // The transport may be unreachable. Force close the HTTP client below.
    } finally {
      client?.close(force: true);
    }
  }
}
