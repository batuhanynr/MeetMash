import 'package:flutter_test/flutter_test.dart';
import 'package:meetmesh/app.dart';

void main() {
  testWidgets('opens the app shell', (tester) async {
    await tester.pumpWidget(const MeetMeshApp());
    expect(find.text('MeetMesh'), findsOneWidget);
  });
}
