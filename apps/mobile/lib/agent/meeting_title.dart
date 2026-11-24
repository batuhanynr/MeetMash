const defaultMeetingTitle = 'MeetMesh';
const maxMeetingTitleLength = 100;

String normalizeMeetingTitle(Object? value) {
  if (value is! String) return defaultMeetingTitle;
  final text = value.replaceAll(RegExp(r'\s+', unicode: true), ' ').trim();
  final bounded = String.fromCharCodes(
    text.runes.take(maxMeetingTitleLength),
  ).trimRight();
  return bounded.isEmpty ? defaultMeetingTitle : bounded;
}
