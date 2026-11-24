import 'package:google_sign_in/google_sign_in.dart';
import 'dart:io';
import 'calendar.dart';

class CalendarAccount {
  final String email;
  late final GoogleSignIn signIn;
  static const scopes = [
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/calendar.events.owned',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  ];
  CalendarAccount(this.email) {
    const ios = String.fromEnvironment('GOOGLE_IOS_CLIENT_ID'),
        server = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');
    signIn = GoogleSignIn(
      clientId: Platform.isIOS && ios.isNotEmpty ? ios : null,
      serverClientId: server.isNotEmpty ? server : null,
      scopes: scopes,
    );
  }
  Future<void> authorize() async {
    final account = await signIn.signIn();
    if (account == null || account.email.toLowerCase() != email.toLowerCase()) {
      await signIn.signOut();
      throw StateError('Bu cihaz için atanmış Google hesabını seç.');
    }
    if (!await signIn.requestScopes(scopes)) {
      await signIn.signOut();
      throw StateError('Takvim izni verilmedi.');
    }
  }

  Future<String> token() async {
    final account = signIn.currentUser ?? await signIn.signInSilently();
    if (account?.email.toLowerCase() != email.toLowerCase()) {
      throw const CalendarAuthorizationRequired();
    }
    final token = (await account!.authentication).accessToken;
    if (token == null) throw const CalendarAuthorizationRequired();
    return token;
  }

  Future<void> revoke() async {
    await signIn.disconnect();
  }
}
