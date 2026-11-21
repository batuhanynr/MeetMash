import 'dart:async';
import 'package:flutter/material.dart';
import 'agent/protocol.dart';
import 'runtime.dart';

class MeetMeshApp extends StatelessWidget {
  const MeetMeshApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'MeetMesh',
    theme: ThemeData(
      colorSchemeSeed: const Color(0xff275858),
      useMaterial3: true,
    ),
    home: const Desk(),
  );
}

class Desk extends StatefulWidget {
  const Desk({super.key});
  @override
  State<Desk> createState() => _DeskState();
}

class _DeskState extends State<Desk> with WidgetsBindingObserver {
  final rt = MobileRuntime();
  final config = TextEditingController(),
      name = TextEditingController(),
      capabilities = TextEditingController(),
      search = TextEditingController(),
      natural = TextEditingController(),
      duration = TextEditingController(text: '60'),
      start = TextEditingController(),
      end = TextEditingController();
  var zone = 'Europe/Istanbul',
      vis = 'public',
      by = 'name',
      tab = 0,
      busy = false;
  final people = <String>{};
  List results = [], friends = [], incoming = [];
  String? notice;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    rt.addListener(refresh);
    unawaited(rt.restore());
  }

  void refresh() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        rt.connection != null &&
        !rt.connection!.online) {
      unawaited(run(rt.reconnect));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    rt.removeListener(refresh);
    rt.dispose();
    for (final c in [
      config,
      name,
      capabilities,
      search,
      natural,
      duration,
      start,
      end,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    setState(() {
      busy = true;
      notice = null;
    });
    try {
      await action();
    } catch (e) {
      notice = e is StateError
          ? e.message
          : e is FormatException
          ? 'Girdiyi kontrol et.'
          : 'İşlem tamamlanamadı. Bağlantıyı kontrol et.';
    } finally {
      busy = false;
      refresh();
    }
  }

  Future<Json> call(String kind, [Json? value]) =>
      rt.connection!.control({'kind': kind, ...?value});
  Future<void> profile() async {
    final p = (await call('profile.get'))['profile'];
    if (p != null) {
      name.text = p['displayName'];
      capabilities.text = (p['capabilities'] as List).join(', ');
      vis = p['visibility'];
    }
    final f = await call('friends.list');
    friends = f['friends'];
    incoming = f['incoming'];
  }

  Widget field(
    String label,
    TextEditingController c, {
    int lines = 1,
    bool secret = false,
    TextInputType? keyboard,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: TextField(
      controller: c,
      keyboardType: keyboard,
      autocorrect: false,
      enableSuggestions: !secret,
      obscureText: secret,
      maxLines: secret ? 1 : lines,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
    ),
  );
  Widget button(String s, Future<void> Function() action) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: FilledButton.tonal(
      onPressed: busy ? null : () => run(action),
      child: Text(s),
    ),
  );
  String localInput(String iso) {
    final d = DateTime.parse(
      iso,
    ).toUtc().add(Duration(hours: zone == 'Europe/Istanbul' ? 3 : 0));
    return d.toIso8601String().substring(0, 16);
  }

  String absolute(String local) {
    final v = local.trim();
    if (!RegExp(r'^\d{4}-\d\d-\d\dT\d\d:\d\d$').hasMatch(v)) {
      throw const FormatException();
    }
    final result = DateTime.parse(
      '$v:00${zone == 'Europe/Istanbul' ? '+03:00' : 'Z'}',
    );
    if (localInput(utc(result)) != v) throw const FormatException();
    return utc(result);
  }

  Widget dropdown(
    String value,
    List<String> values,
    void Function(String) change,
  ) => DropdownButton<String>(
    value: value,
    onChanged: (v) {
      if (v != null) setState(() => change(v));
    },
    items: [for (final v in values) DropdownMenuItem(value: v, child: Text(v))],
  );
  @override
  Widget build(BuildContext context) {
    final connected = rt.connection?.online == true;
    final meetings = (rt.agent?.store.data['meetings'] ?? {}) as Map;
    final events = (rt.agent?.store.data['events'] ?? {}) as Map;
    return Scaffold(
      appBar: AppBar(
        title: const Text('MeetMesh'),
        actions: [
          if (rt.config != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Chip(label: Text(connected ? 'Bağlı' : 'Çevrimdışı')),
            ),
        ],
      ),
      bottomNavigationBar: rt.agent == null
          ? null
          : NavigationBar(
              selectedIndex: tab,
              onDestinationSelected: (i) {
                setState(() => tab = i);
                if (i == 3 && connected) unawaited(run(profile));
              },
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.forum_outlined),
                  label: 'Toplantılar',
                ),
                NavigationDestination(
                  icon: Icon(Icons.event_available),
                  label: 'Planla',
                ),
                NavigationDestination(
                  icon: Icon(Icons.calendar_today),
                  label: 'Takvim',
                ),
                NavigationDestination(
                  icon: Icon(Icons.person_outline),
                  label: 'Profil',
                ),
              ],
            ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            if (notice != null ||
                rt.error != null ||
                rt.connection?.lastError != null)
              Text(
                notice ?? rt.error ?? rt.connection!.lastError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            if (rt.agent == null) ...[
              const Text('Ajan hesabını bağla', style: TextStyle(fontSize: 24)),
              const Text(
                'Bu cihaz için hazırlanan hesap yapılandırmasını yapıştır.',
              ),
              field('Hesap yapılandırması', config, secret: true),
              button('Bağlan', () async {
                await rt.start(config.text);
                config.clear();
              }),
            ] else ...[
              if (!connected) button('Yeniden bağlan', rt.reconnect),
              if (tab == 0) ...[
                if (meetings.isEmpty) const Text('Henüz toplantı yok.'),
                for (final m in meetings.values.toList().reversed)
                  Card(
                    child: ExpansionTile(
                      title: Text(status(m)),
                      subtitle: Text(m['meetingId']),
                      children: [
                        if (m['selected'] != null)
                          ListTile(
                            title: Text(
                              '${localInput(m['selected']['start'])} · $zone',
                            ),
                          ),
                        ListTile(
                          title: Text((m['participants'] as List).join(', ')),
                        ),
                        if (m['decision'] == 'COMMIT' &&
                            m['coordinator'] == rt.config!.id)
                          Text(
                            'Yazımı beklenen: ${(m['participants'] as List).where((v) => m['applied'][v] != true).join(', ')}',
                          ),
                        if (m['error'] != null) Text(m['error']),
                        if (m['status'] == 'AWAITING_USER')
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              button(
                                'Kabul et',
                                () async =>
                                    rt.agent!.vote(m['meetingId'], true),
                              ),
                              button(
                                'Reddet',
                                () async =>
                                    rt.agent!.vote(m['meetingId'], false),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
              ],
              if (tab == 1) ...[
                field('Toplantı isteğini yaz', natural, lines: 2),
                button('Önizlemeyi hazırla', () async {
                  final res = await call('meeting.preview', {
                    'text': natural.text,
                    'timeZone': zone,
                  });
                  if (res['status'] != 'ready') {
                    notice = (res['questions'] as List?)?.join(' ');
                    if (notice == null || notice!.isEmpty) {
                      notice = 'İsteği aşağıdaki formdan tamamla.';
                    }
                    return;
                  }
                  people
                    ..clear()
                    ..addAll(
                      List<String>.from(res['participantAgentIds'])
                        ..remove(rt.config!.id),
                    );
                  duration.text = '${res['durationMinutes']}';
                  start.text = localInput(res['window']['start']);
                  end.text = localInput(res['window']['end']);
                  notice = 'Katılımcıları ve saati kontrol edip onayla.';
                }),
                dropdown(by, ['name', 'id', 'semantic'], (v) => by = v),
                field('Ajan ara', search),
                button('Ara', () async {
                  final res = await call('directory.lookup', {
                    'by': by,
                    'term': search.text,
                  });
                  results = res['agents'];
                  if (res['mode'] == 'unavailable') {
                    notice =
                        'Anlamsal arama kullanılamıyor. İsim veya kimlikle arayabilirsin.';
                  }
                }),
                for (final p in results.where(
                  (p) => p['agentId'] != rt.config!.id,
                ))
                  ListTile(
                    title: Text(p['displayName']),
                    subtitle: Text(p['agentId']),
                    onTap: () => setState(() => people.add(p['agentId'])),
                    trailing: IconButton(
                      tooltip: 'Arkadaşlık isteği',
                      icon: const Icon(Icons.person_add_alt),
                      onPressed: () => run(() async {
                        await call('friends.request', {'target': p['agentId']});
                        notice = 'İstek gönderildi';
                      }),
                    ),
                  ),
                Wrap(
                  children: [
                    for (final p in people)
                      InputChip(
                        label: Text(p),
                        onDeleted: () => setState(() => people.remove(p)),
                      ),
                  ],
                ),
                dropdown(zone, ['Europe/Istanbul', 'UTC'], (v) => zone = v),
                field('Başlangıç · YYYY-MM-DDTHH:MM', start),
                field('Bitiş · YYYY-MM-DDTHH:MM', end),
                field(
                  'Süre (dakika)',
                  duration,
                  keyboard: TextInputType.number,
                ),
                button('Onayla ve toplantıyı başlat', () async {
                  await rt.agent!.schedule(people.toList(), {
                    'start': absolute(start.text),
                    'end': absolute(end.text),
                  }, int.parse(duration.text));
                  tab = 0;
                }),
              ],
              if (tab == 2) ...[
                Text(
                  rt.config!.provider == 'google'
                      ? 'Google Calendar'
                      : 'Örnek takvim',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                if (rt.google != null) ...[
                  button('Google hesabına izin ver', rt.google!.authorize),
                  button('Google iznini kaldır', rt.google!.revoke),
                ],
                if (events.isEmpty) const Text('Kaydedilmiş toplantı yok.'),
                for (final e in events.entries)
                  ListTile(
                    title: Text(localInput(e.value['start'])),
                    subtitle: Text('${e.key} · $zone'),
                  ),
              ],
              if (tab == 3) ...[
                Text(rt.config!.id),
                field('Görünen ad', name),
                field('Yetenekler (virgülle)', capabilities),
                dropdown(vis, ['private', 'friends', 'public'], (v) => vis = v),
                button('Profili kaydet', () async {
                  await call('profile.save', {
                    'displayName': name.text,
                    'visibility': vis,
                    'capabilities': capabilities.text
                        .split(',')
                        .map((v) => v.trim())
                        .where((v) => v.isNotEmpty)
                        .toList(),
                  });
                  await profile();
                }),
                for (final p in incoming)
                  ListTile(
                    title: Text(p),
                    trailing: button('İsteği kabul et', () async {
                      await call('friends.accept', {'target': p});
                      await profile();
                    }),
                  ),
                for (final p in friends)
                  ListTile(title: Text(p), leading: const Icon(Icons.people)),
              ],
            ],
          ],
        ),
      ),
    );
  }

  String status(Json m) => switch (m['status']) {
    'COLLECTING' =>
      rt.connection!.online ? 'Katılımcılar bekleniyor' : 'Kuyrukta',
    'AWAITING_USER' => 'Onayın bekleniyor',
    'AWAITING_ACCEPT' => 'Katılımcı onayı bekleniyor',
    'PENDING_RECOVERY' => 'Karar bekleniyor',
    'COMMIT_PENDING' => 'Takvime yazılıyor',
    'CONFIRMED' => 'Tamamlandı',
    'APPLIED' => 'Takvimine kaydedildi',
    'DECLINED' => 'Reddedildi',
    'ABORTED' => 'Toplantı iptal edildi (${m['reason']})',
    _ => m['status'],
  };
}
