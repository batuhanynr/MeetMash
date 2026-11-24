import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'agent/agent_picker.dart';
import 'agent/connection.dart';
import 'agent/meeting_agent.dart';
import 'agent/meeting_timeline.dart';
import 'agent/meeting_title.dart';
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
      email = TextEditingController(),
      password = TextEditingController(),
      name = TextEditingController(),
      natural = TextEditingController(),
      meetingTitle = TextEditingController(),
      duration = TextEditingController(text: '60');
  var zone = 'Europe/Istanbul', vis = 'public', tab = 0, busy = false;
  final people = <String>{};
  final agents = <String, String>{};
  final calendarPreview = GlobalKey<CalendarPreviewState>();
  bool agentsLoading = false;
  String? agentsError;
  final agentNames = <String, String>{};
  final requestedNames = <String>{};
  List friends = [], incoming = [];
  MeetingWindow? window;
  DateTime? calendarDay;
  int calendarAuthorization = 0;
  bool wasOnline = false;
  bool restoring = true;
  String? notice;
  String? previewHint;

  CalendarClock get clock => CalendarClock(zone);
  Map<String, dynamic> get meetings =>
      (rt.agent?.store.data['meetings'] ?? <String, dynamic>{})
          as Map<String, dynamic>;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    rt.addListener(refresh);
    unawaited(
      rt.restore().whenComplete(() {
        if (mounted) setState(() => restoring = false);
      }),
    );
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
    if (online && !wasOnline) {
      requestedNames.clear();
      if (rt.config?.provider == 'managed') calendarAuthorization++;
    }
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
    final connection = rt.connection;
    if (connection == null) return;
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
          final res = await connection.control({
            'kind': 'directory.lookup',
            'by': 'id',
            'term': id,
          });
          final profiles = (res['agents'] as List).cast<Json>();
          if (!mounted || rt.connection != connection) return;
          setState(() {
            if (profiles.isEmpty) {
              agentNames.remove(id);
            } else {
              rememberName(profiles.first);
            }
          });
        } catch (_) {
          if (rt.connection == connection) requestedNames.remove(id);
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
    for (final c in [
      config,
      email,
      password,
      name,
      natural,
      meetingTitle,
      duration,
    ]) {
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
          ? e.description
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

  void selectAgent(String id, bool selected) {
    setState(() {
      if (selected) {
        people.add(id);
      } else {
        people.remove(id);
      }
    });
  }

  Future<void> loadAgents() async {
    final connection = rt.connection;
    if (agentsLoading) return;
    if (connection?.online != true) {
      setState(() => agentsError = 'Ajanları görmek için yeniden bağlan.');
      return;
    }
    setState(() {
      agentsLoading = true;
      agentsError = null;
    });
    try {
      final res = await connection!.control({'kind': 'directory.list'});
      if (!mounted || connection != rt.connection) return;
      final profiles = (res['agents'] as List).cast<Json>()
        ..sort(
          (a, b) => (a['displayName'] as String).compareTo(
            b['displayName'] as String,
          ),
        );
      setState(() {
        agents.clear();
        for (final p in profiles) {
          rememberName(p);
          agents[p['agentId']] = p['displayName'];
        }
      });
    } catch (_) {
      if (mounted && connection == rt.connection) {
        setState(() => agentsError = 'Ajan listesi yüklenemedi.');
      }
    } finally {
      if (mounted && connection == rt.connection) {
        setState(() => agentsLoading = false);
      }
    }
  }

  Widget refreshableCalendar(Widget child) {
    return SafeArea(
      child: tab == 2 && rt.agent != null
          ? RefreshIndicator(
              onRefresh: () async =>
                  await calendarPreview.currentState?.refresh(),
              child: child,
            )
          : child,
    );
  }

  Future<void> signOut() async {
    await rt.signOut();
    if (!mounted) return;
    for (final controller in [
      email,
      password,
      name,
      natural,
      meetingTitle,
    ]) {
      controller.clear();
    }
    duration.text = '60';
    people.clear();
    agents.clear();
    agentsLoading = false;
    agentsError = null;
    agentNames.clear();
    requestedNames.clear();
    friends = [];
    incoming = [];
    tab = 0;
    vis = 'public';
    window = null;
    previewHint = null;
    calendarDay = null;
  }

  Future<void> profile() async {
    final p = (await call('profile.get'))['profile'];
    if (p != null) {
      rememberName(p);
      name.text = p['displayName'];
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
    int? maxLength,
    bool secret = false,
    TextInputType? keyboard,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: TextField(
      controller: c,
      maxLength: maxLength,
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
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              'assets/brand/meetmesh-mark.png',
              width: 34,
              height: 34,
              excludeFromSemantics: true,
            ),
            const SizedBox(width: 6),
            const Text('MeetMesh'),
          ],
        ),
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
      body: refreshableCalendar(
        ListView(
          key: PageStorageKey(tab),
          physics: tab == 2 ? const AlwaysScrollableScrollPhysics() : null,
          padding: const EdgeInsets.all(18),
          children: [
            if (notice != null ||
                rt.error != null ||
                rt.connection?.lastError != null)
              Text(
                notice ?? rt.error ?? rt.connection!.lastError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            if (restoring)
              const LinearProgressIndicator(semanticsLabel: 'Hesap yükleniyor')
            else if (rt.agent == null) ...[
              const Text(
                'MeetMesh’e giriş yap',
                style: TextStyle(fontSize: 24),
              ),
              field('E-posta', email, keyboard: TextInputType.emailAddress),
              field('MeetMesh şifresi', password, secret: true),
              button('Giriş yap', () async {
                try {
                  await rt.signIn(email.text, password.text);
                } finally {
                  if (mounted) password.clear();
                }
              }),
              if (configuredHub.isEmpty)
                ExpansionTile(
                  key: const PageStorageKey('test-account'),
                  title: const Text('Test hesabı yapılandırması'),
                  children: [
                    field('Hesap yapılandırması', config, secret: true),
                    button('Bağlan', () async {
                      await rt.start(config.text);
                      if (mounted) config.clear();
                    }),
                  ],
                ),
            ] else ...[
              if (!connected) button('Yeniden bağlan', rt.reconnect),
              if (tab == 0) ...[
                if (meetings.isEmpty) const Text('Henüz toplantı yok.'),
                for (final m in meetings.values.toList().reversed)
                  Card(
                    child: ExpansionTile(
                      key: PageStorageKey('meeting-${m['meetingId']}'),
                      title: Text(normalizeMeetingTitle(m['title'])),
                      subtitle: Text(
                        '${status(m)} · ${meetingRange(m['selected'] ?? m['window'])}',
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
                        MeetingTimeline(
                          moves: (m['moves'] as List? ?? const []).cast<Json>(),
                          agentLabel: agentLabel,
                          clock: clock,
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
                  setState(() => previewHint = null);
                  final res = await call('meeting.preview', {
                    'text': natural.text,
                    'timeZone': zone,
                  });
                  if (!mounted) return;
                  final questions = (res['questions'] as List?)?.join(' ');
                  if (res['status'] == 'unavailable' ||
                      res['kind'] == 'error') {
                    notice =
                        questions ??
                        'Önizleme hazırlanamadı. Formu kullanabilirsin.';
                    return;
                  }
                  if (res['title'] is String) {
                    meetingTitle.text = normalizeMeetingTitle(res['title']);
                  }
                  final suggestedPeople = (res['participantAgentIds'] as List)
                      .cast<String>()
                      .where((id) => id != rt.config!.id)
                      .toSet();
                  if (suggestedPeople.isNotEmpty) {
                    people
                      ..clear()
                      ..addAll(suggestedPeople);
                    if (people.any((id) => !agents.containsKey(id))) {
                      unawaited(loadAgents());
                    }
                  }
                  final minutes = res['durationMinutes'];
                  if (minutes is int) duration.text = '$minutes';
                  final draft = res['window'] as Json?;
                  if (draft != null) {
                    window = (start: startOf(draft), end: endOf(draft));
                  }
                  previewHint = questions == null || questions.isEmpty
                      ? 'Önizlemeyi kontrol edip onayla.'
                      : questions;
                }),
                if (previewHint != null) Text(previewHint!),
                field(
                  'Toplantı adı',
                  meetingTitle,
                  maxLength: maxMeetingTitleLength,
                ),
                AgentPicker(
                  agents: agents,
                  selected: people,
                  onChanged: selectAgent,
                  onOpen: loadAgents,
                  loading: agentsLoading,
                  error: agentsError,
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
                  futureOnly: rt.config!.liveCalendar,
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
                  if (rt.config!.liveCalendar &&
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
                  final agent = rt.agent!;
                  final participants = people.toList();
                  final slot = {
                    'start': utc(selected.start),
                    'end': utc(selected.end),
                  };
                  final title = meetingTitle.text;
                  try {
                    await agent.schedule(
                      participants,
                      slot,
                      minutes,
                      title: title,
                    );
                  } on CalendarOverlapNeedsApproval {
                    if (!context.mounted) return;
                    final approved = await showDialog<bool>(
                      context: context,
                      builder: (dialogContext) => AlertDialog(
                        title: const Text('Takvim çakışması'),
                        content: const Text(
                          'Seçtiğin aralıkta takvimindeki etkinlikler nedeniyle '
                          'toplantı süresine yetecek boş zaman yok. Yine de '
                          'toplantı isteğini göndermek ister misin?',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () =>
                                Navigator.pop(dialogContext, false),
                            child: const Text('Vazgeç'),
                          ),
                          FilledButton(
                            onPressed: () => Navigator.pop(dialogContext, true),
                            child: const Text('Yine de gönder'),
                          ),
                        ],
                      ),
                    );
                    if (approved != true || !mounted || rt.agent != agent) {
                      return;
                    }
                    if (rt.connection?.displaced == true) {
                      throw StateError('Bu oturum başka cihaza geçti.');
                    }
                    await agent.schedule(
                      participants,
                      slot,
                      minutes,
                      title: title,
                      allowCalendarOverlap: true,
                    );
                  }
                  tab = 0;
                }),
              ],
              if (tab == 2) ...[
                Text(
                  rt.config!.liveCalendar
                      ? GoogleCalendar.title
                      : 'Örnek takvim',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                if (rt.google != null) ...[
                  button('Google hesabına izin ver', () async {
                    try {
                      await rt.google!.authorize();
                    } finally {
                      (rt.agent!.calendar as GoogleCalendar).clearEventCache();
                      calendarAuthorization++;
                    }
                    await rt.agent!.retryCalendarWrites();
                  }),
                  button('Google iznini kaldır', () async {
                    await rt.google!.revoke();
                    (rt.agent!.calendar as GoogleCalendar).clearEventCache();
                    calendarAuthorization++;
                    notice = 'Google takvim izni kaldırıldı.';
                  }),
                ],
                CalendarPreview(
                  key: calendarPreview,
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
                if (rt.config?.email case final address?) Text(address),
                if (connected) button('Profili yenile', profile),
                field('Görünen ad', name),
                dropdown(vis, ['private', 'friends', 'public'], (v) => vis = v),
                button('Profili kaydet', () async {
                  await call('profile.save', {
                    'displayName': name.text,
                    'visibility': vis,
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
                if (rt.config!.provider == 'managed' ||
                    configuredHub.isNotEmpty)
                  button('Oturumu kapat', signOut),
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
    'ABORTED' => switch (m['reason']) {
      'NO_COMMON_SLOT' => 'Ortak müsait saat bulunamadı',
      'TIMEOUT' => 'Yanıt süresi doldu',
      'DECLINED' => 'Toplantı reddedildi',
      _ => 'Toplantı iptal edildi',
    },
    _ => m['status'],
  };
}
