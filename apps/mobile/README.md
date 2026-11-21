# MeetMesh mobile

Flutter screens and the headless Dart client use the same foreground meeting agent. The app keeps the provisioned account in platform secure storage. A local file holds the agent's inbox, outbox, reservations, decisions and applied events. The app retries a broken hub connection while it is open and recovers pending meetings from local storage when reopened.

## One iPhone and two Mac agents

Ada runs in Flutter on the iPhone. Ece and Deniz run as separate Node processes on the Mac, each with its own SQLite state and synthetic calendar. Use a Mac and iPhone on the same local network. From the repository root, set `PHONE_LAB_HOST` to the Mac's address on that network and start the lab with a dedicated PostgreSQL database.

```sh
export PHONE_LAB_HOST="$(ipconfig getifaddr en0)"
export M5_PHONE_DATABASE_URL=postgresql://127.0.0.1:5432/meetmesh_phone_lab
export CERT_DIR=.state/m5-phone/certs
export SECRETS_FILE=.state/m5-phone/secrets.json
createdb -h 127.0.0.1 meetmesh_phone_lab
(umask 077; CERT_EXTRA_HOST="$PHONE_LAB_HOST" npm run certs && npm run secrets)
MEETMESH_DATA_HOST="$PHONE_LAB_HOST" npm run demo:m5:phone
```

Create the database once, then reuse it with the same secrets. If the Mac's address changes, rerun certificate generation with `CERT_FORCE=1` and copy the new phone account file after restarting the lab.

Build and install MeetMesh on the paired iPhone using your Xcode development team and `--dart-define=MEETMESH_PHONE_LAB=true`. Start the app once to create its Application Support directory, then copy the phone account over USB from the repository root. Set `IOS_DEVICE` to the identifier from `xcrun devicectl list devices`.

```sh
xcrun devicectl device copy to --device "$IOS_DEVICE" \
  --domain-type appDataContainer --domain-identifier com.meetmesh.meetmesh \
  --source .state/m5-phone/meetmesh-phone-account.json \
  --destination 'Library/Application Support/meetmesh-phone-account.json'
xcrun devicectl device process launch --device "$IOS_DEVICE" \
  --terminate-existing com.meetmesh.meetmesh
```

Allow local network access on the iPhone if prompted. Open [the demo panel](http://127.0.0.1:8790/) on the Mac. Its activity comes from authenticated connections, durable queue entries and WSS forwards. Availability replies and calendar write receipts light up the corresponding calendars. The panel keeps a short recent history and displays no calendar contents or credentials.

In “Planla”, search for Ece and Deniz by name and select each result. Use Europe/Istanbul, `2026-11-10T10:00` to `2026-11-10T16:00`, and 60 minutes. These dates are part of the synthetic fixture. To test manual approval, send Ece's invitation from the panel and accept it under “Toplantılar” on the iPhone. The Deniz control stops or starts that Mac agent, which lets you watch forwarding resume after reconnect. Press Ctrl+C in the terminal running the lab to stop the hub, panel and both Mac agents.

## Connect two devices

1. On the development machine, prepare the demo credentials and hub certificate with `npm run secrets` and `npm run certs` from the repository root.
2. Point `M5_DEVICE_DATABASE_URL` at a dedicated PostgreSQL database and start `npm run demo:m5:devices`. It provisions Ada and Ece and prints the directory containing their individual account files. The hub must be reachable from each device at the address in its file. The TLS certificate must include that host. An iOS simulator can access a Mac hub on loopback. For an Android emulator or USB-connected test phone, `adb reverse tcp:8787 tcp:8787` forwards that port to the development machine. For a LAN IP or name, generate a separate certificate with `CERT_DIR=.state/device-certs CERT_EXTRA_HOST=<host> npm run certs`. Set `CERT_DIR=.state/device-certs` and `MEETMESH_DATA_HOST=<host>` when starting the device hub.
3. From `apps/mobile`, use `flutter pub get --offline` with a populated cache, then `flutter run -d <device>` on each target. Paste one device's account JSON into “Ajan hesabını bağla”. Transfer each file privately to the device that owns that identity. A second connection with the same identity displaces its earlier session.
4. In “Planla”, look up the other agent, select a time zone, enter the local start and end as `YYYY-MM-DDTHH:MM`, then choose a duration. “Önizleme” fills the form from a Turkish request if the hub has a language model. Check the participants and time before pressing “Onayla ve toplantıyı başlat”.
5. On the receiving device, open the proposed meeting and accept or reject it. After every calendar confirms the write, the organizer sees “Tamamlandı”. “Takvim” lists that agent's applied meetings.

The bundled synthetic calendars cover November 10, 2026. For a fixture run use the structured form, Europe/Istanbul, 10:00 through 16:00, and a duration of 60 minutes. The result depends on the participants and existing reservations. Profile edits, visibility and friend requests are under “Profil” and agent search. Both mobile clients should stay in the foreground during the demo.

## Use Google test calendars

Enable the Calendar API in the demo's Google Cloud project and add the consenting test accounts to its OAuth consent configuration. Register the Android package and iOS bundle ID `com.meetmesh.meetmesh`. Android also needs the SHA-1 of the certificate signing the installed build. On iOS, put the reversed iOS client ID into an untracked `ios/Flutter/Google.local.xcconfig`:

```xcconfig
GOOGLE_REVERSED_CLIENT_ID = com.googleusercontent.apps.YOUR_IOS_CLIENT_ID
```

Supply the iOS client ID to the corresponding Flutter build with `--dart-define=GOOGLE_IOS_CLIENT_ID=...`. Use `--dart-define=GOOGLE_WEB_CLIENT_ID=...` for the web client ID associated with the Android project. Both accounts must come from the same demo provisioning configuration; set `M5_GOOGLE_A` and `M5_GOOGLE_B` to their distinct email addresses before starting the device hub. Use fresh app installations for this live run so no previous fixture identity or reservations carry over.

Each account holder opens “Takvim”, chooses “Google hesabına izin ver” and signs in with the assigned account. Schedule a **future** test window. Free/busy queries and the local reservation check run before voting. Calendar contents can still change outside MeetMesh after a vote. After COMMIT, the client looks up a stable per-agent event ID and reconciles a lost write response. A missing grant or failed write leaves the meeting pending. The organizer sees which participant has not written. On that participant's device, a missing grant prompts them to authorize again under “Takvim”. Restoring access lets the same write resume. “Google iznini kaldır” revokes the grant.

## Verification

`flutter analyze` and `flutter test` cover the Dart code and fixture tests. `flutter build apk --debug` produces the debug APK. Confirm installation and launch separately on each target. Use the repository's M5 evidence records for what was actually verified. The headless WSS run demonstrates the foreground Dart core with a synthetic calendar; live Google verification requires both consenting accounts.
