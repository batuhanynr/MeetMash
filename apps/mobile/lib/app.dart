import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'agent/protocol.dart';
import 'calendar/calendar.dart';
import 'calendar/calendar_clock.dart';
import 'calendar/calendar_preview.dart';
import 'calendar/meeting_window_fields.dart';
import 'runtime.dart';

class MeetMeshApp extends StatelessWidget {
  const MeetMeshApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'MeetMesh',
    locale: const Locale('tr', 'TR'),
    supportedLocales: const [Locale('tr', 'TR')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
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
      duration = TextEditingController(text: '60');
  var zone = 'Europe/Istanbul',
      vis = 'public',
      by = 'name',
      tab = 0,
      busy = false;
  final people = <String>{};
  final agentNames = <String, String>{};
  final requestedNames = <String>{};
  List results = [], friends = [], incoming = [];
  MeetingWindow? window;
  DateTime? calendarDay;
  int calendarAuthorization = 0;
  bool wasOnline = false;
  String? notice;

  CalendarClock get clock => CalendarClock(zone);
  Map<String, dynamic> get meetings =>
      (rt.agent?.store.data['meetings'] ?? <String, dynamic>{})
          as Map<String, dynamic>;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    rt.addListener(refresh);
    unawaited(rt.restore());
  }

  void refresh() {
    if (!mounted) return;
    setState(() {
      final fixture = rt.fixtureWindow;
      if (window == null && fixture != null) {
        window = (start: startOf(fixture), end: endOf(fixture));
      }
    });
    final online = rt.connection?.online == true;
    if (online && !wasOnline) requestedNames.clear();
    wasOnline = online;
    if (online) unawaited(resolveNames());
  }

  void rememberName(Json profile) {
    final id = profile['agentId'], displayName = profile['displayName'];
    if (id is String && displayName is String && displayName.isNotEmpty) {
      agentNames[id] = displayName;
    }
  }

  String agentLabel(String id) {
    final displayName = agentNames[id];
    if (displayName != null) return '$displayName · Ajan';
    return id == rt.config?.id ? 'Benim ajanım' : 'Katılımcı ajan';
  }

  Future<void> resolveNames() async {
    final ids = <String>{
      if (rt.config != null) rt.config!.id,
      ...people,
      ...friends.cast<String>(),
      ...incoming.cast<String>(),
      for (final meeting in meetings.values)
        ...(meeting['participants'] as List).cast<String>(),
    }.difference(requestedNames);
    requestedNames.addAll(ids);
    await Future.wait(
      ids.map((id) async {
        try {
          final res = await call('directory.lookup', {'by': 'id', 'term': id});
          final profiles = (res['agents'] as List).cast<Json>();
          if (!mounted) return;
          setState(() {
            if (profiles.isEmpty) {
              agentNames.remove(id);
            } else {
              rememberName(profiles.first);
            }
          });
        } catch (_) {
          requestedNames.remove(id);
        }
      }),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    rt.setForeground(state == AppLifecycleState.resumed);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    rt.removeListener(refresh);
    rt.dispose();
    for (final c in [config, name, capabilities, search, natural, duration]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy || !mounted) return;
    setState(() {
      busy = true;
      notice = null;
    });
    try {
      await action();
    } catch (e) {
      notice = e is CalendarAuthorizationRequired
          ? CalendarAuthorizationRequired.message
          : e is StateError
          ? e.message
          : e is FormatException
          ? (e.message.isEmpty ? 'Girdiyi kontrol et.' : e.message)
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
      rememberName(p);
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
      enabled: !busy,
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
  Widget dropdown(
    String value,
    List<String> values,
    void Function(String) change, {
    Map<String, String> labels = const {},
  }) => DropdownButton<String>(
    value: value,
    onChanged: busy
        ? null
        : (v) {
            if (v != null) setState(() => change(v));
          },
    items: [
      for (final v in values)
        DropdownMenuItem(value: v, child: Text(labels[v] ?? v)),
    ],
  );
  @override
  Widget build(BuildContext context) {
    final connected = rt.connection?.online == true;
    final events =
        (rt.agent?.store.data['events'] ?? <String, dynamic>{})
            as Map<String, dynamic>;
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
                      subtitle: Text(
                        meetingRange(m['selected'] ?? m['window']),
                      ),
                      children: [
                        ListTile(
                          title: const Text('Katılımcılar'),
                          subtitle: Text(
                            (m['participants'] as List)
                                .cast<String>()
                                .map(agentLabel)
                                .join(', '),
                          ),
                        ),
                        if (m['status'] == 'COMMIT_PENDING' &&
                            m['coordinator'] == rt.config!.id)
                          Text(
                            'Takvime yazması beklenen: ${(m['participants'] as List).cast<String>().where((v) => m['applied'][v] != true).map(agentLabel).join(', ')}',
                          ),
                        if (m['error'] != null) Text(m['error']),
                        if (m['status'] == 'AWAITING_USER' &&
                            rt.connection?.displaced != true)
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
                  final draft = res['window'] as Json;
                  window = (start: startOf(draft), end: endOf(draft));
                  notice = 'Katılımcıları ve saati kontrol edip onayla.';
                }),
                dropdown(
                  by,
                  ['name', 'id', 'semantic'],
                  (v) => by = v,
                  labels: const {
                    'name': 'Ada göre',
                    'id': 'Kimliğe göre',
                    'semantic': 'Anlama göre',
                  },
                ),
                field('Ajan ara', search),
                button('Ara', () async {
                  final res = await call('directory.lookup', {
                    'by': by,
                    'term': search.text,
                  });
                  results = res['agents'];
                  for (final item in results.cast<Json>()) {
                    rememberName(item);
                  }
                  if (res['mode'] == 'unavailable') {
                    notice =
                        'Anlamsal arama kullanılamıyor. İsim veya kimlikle arayabilirsin.';
                  }
                }),
                for (final p in results.where(
                  (p) => p['agentId'] != rt.config!.id,
                ))
                  ListTile(
                    title: Text(agentLabel(p['agentId'])),
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
                        label: Text(agentLabel(p)),
                        onDeleted: () => setState(() => people.remove(p)),
                      ),
                  ],
                ),
                dropdown(
                  zone,
                  ['Europe/Istanbul', 'UTC'],
                  (v) => zone = v,
                  labels: const {'Europe/Istanbul': 'İstanbul saati'},
                ),
                MeetingWindowFields(
                  clock: clock,
                  window: window,
                  futureOnly: rt.config!.provider == 'google',
                  onChanged: busy
                      ? null
                      : (value) => setState(() => window = value),
                ),
                field(
                  'Süre (dakika)',
                  duration,
                  keyboard: TextInputType.number,
                ),
                button('Onayla ve toplantıyı başlat', () async {
                  if (rt.connection?.displaced == true) {
                    throw StateError('Bu oturum başka cihaza geçti.');
                  }
                  final selected = window;
                  if (selected == null) {
                    throw StateError('Takvimden bir tarih aralığı seç.');
                  }
                  if (!selected.end.isAfter(selected.start)) {
                    throw StateError('Bitiş, başlangıçtan sonra olmalı.');
                  }
                  if (rt.config!.provider == 'google' &&
                      selected.start.isBefore(DateTime.now())) {
                    throw StateError(
                      'Google takvimi için gelecekte bir aralık seç.',
                    );
                  }
                  final minutes = int.tryParse(duration.text.trim());
                  if (minutes == null || minutes < 1 || minutes > 1440) {
                    throw StateError(
                      'Toplantı süresini 1–1440 dakika arasında gir.',
                    );
                  }
                  await rt.agent!.schedule(people.toList(), {
                    'start': utc(selected.start),
                    'end': utc(selected.end),
                  }, minutes);
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
                  button('Google hesabına izin ver', () async {
                    await rt.google!.authorize();
                    calendarAuthorization++;
                    await rt.agent!.retryCalendarWrites();
                  }),
                  button('Google iznini kaldır', () async {
                    await rt.google!.revoke();
                    calendarAuthorization++;
                    notice = 'Google takvim izni kaldırıldı.';
                  }),
                ],
                CalendarPreview(
                  clock: clock,
                  calendar: rt.agent!.calendar,
                  savedEvents: events.values.cast<Json>(),
                  day:
                      calendarDay ??
                      clock.day(
                        rt.fixtureWindow == null
                            ? DateTime.now()
                            : startOf(rt.fixtureWindow!),
                      ),
                  onDateChanged: (day) => setState(() => calendarDay = day),
                  authorizationRevision: calendarAuthorization,
                ),
              ],
              if (tab == 3) ...[
                Text(
                  agentLabel(rt.config!.id),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                if (connected) button('Profili yenile', profile),
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
                    title: Text(agentLabel(p)),
                    trailing: button('İsteği kabul et', () async {
                      await call('friends.accept', {'target': p});
                      await profile();
                    }),
                  ),
                for (final p in friends)
                  ListTile(
                    title: Text(agentLabel(p)),
                    leading: const Icon(Icons.people),
                  ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  String meetingRange(Json range) => clock.range(startOf(range), endOf(range));

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
