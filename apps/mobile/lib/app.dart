import 'package:flutter/material.dart';

class MeetMeshApp extends StatelessWidget {
  const MeetMeshApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MeetMesh',
      theme: ThemeData(colorSchemeSeed: Colors.indigo),
      home: const Scaffold(
        body: SafeArea(
          child: Center(child: Text('MeetMesh')),
        ),
      ),
    );
  }
}
