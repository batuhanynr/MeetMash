import 'dart:convert';
import 'dart:io';
import 'protocol.dart';

/// One foreground agent owns this snapshot. Mutation, inbox and derived outbox
/// commit together by fsync + rename before sending anything to the socket.
class AgentStore {
  final File file;
  late Json data;
  late final RandomAccessFile _lock;
  AgentStore(this.file, String owner) {
    file.parent.createSync(recursive: true);
    _lock = File('${file.path}.lock').openSync(mode: FileMode.append);
    try {
      _lock.lockSync(FileLock.exclusive);
      data = file.existsSync()
        ? jsonDecode(file.readAsStringSync())
        : {
            'owner': owner,
            'inbox': {},
            'outbox': {},
            'nonces': {},
            'sequences': {},
            'meetings': {},
            'events': {},
          };
      if (data['owner'] != owner) throw StateError('Wrong agent state');
    } catch (_) {
      close();
      rethrow;
    }
  }
  void commit(Json next) {
    final temp = File('${file.path}.next');
    temp.writeAsStringSync(jsonEncode(next), flush: true);
    temp.renameSync(file.path);
    data = next;
  }

  Json copy() => jsonDecode(jsonEncode(data));
  void close() => _lock.closeSync();
}
