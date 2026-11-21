import 'package:google_sign_in/google_sign_in.dart';
import 'dart:io';

class CalendarAccount {
  final String email;
  late final GoogleSignIn signIn;
  static const scopes = [
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/calendar.events.owned',
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
      throw StateError('Choose the configured test calendar account');
    }
    if (!await signIn.requestScopes(scopes)) {
      throw StateError('Calendar permission declined');
    }
  }

  Future<String> token() async {
    final account = signIn.currentUser ?? await signIn.signInSilently();
    if (account?.email.toLowerCase() != email.toLowerCase()) {
      throw StateError('Calendar authorization required');
    }
    final token = (await account!.authentication).accessToken;
    if (token == null) throw StateError('Calendar authorization required');
    return token;
  }

  Future<void> revoke() async {
    await signIn.disconnect();
  }
}
