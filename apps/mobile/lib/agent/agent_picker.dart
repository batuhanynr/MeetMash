import 'package:flutter/material.dart';

class AgentPicker extends StatelessWidget {
  const AgentPicker({
    super.key,
    required this.agents,
    required this.selected,
    required this.onChanged,
    required this.onOpen,
    this.loading = false,
    this.error,
  });

  final Map<String, String> agents;
  final Set<String> selected;
  final void Function(String id, bool checked) onChanged;
  final VoidCallback onOpen;
  final bool loading;
  final String? error;

  @override
  Widget build(BuildContext context) => ExpansionTile(
    key: const PageStorageKey('participant-picker'),
    title: const Text('Katılımcı seç'),
    onExpansionChanged: (open) {
      if (open) onOpen();
    },
    children: [
      if (loading) const LinearProgressIndicator(),
      if (error != null)
        ListTile(
          title: Text(error!),
          trailing: TextButton(
            onPressed: onOpen,
            child: const Text('Tekrar dene'),
          ),
        ),
      if (agents.isEmpty && !loading && error == null)
        const ListTile(title: Text('Seçilebilecek ajan yok.')),
      if (agents.isNotEmpty)
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 264),
          child: ListView(
            key: const PageStorageKey('participant-list'),
            shrinkWrap: true,
            primary: false,
            children: [
              for (final agent in agents.entries)
                CheckboxListTile(
                  title: Text(agent.value),
                  controlAffinity: ListTileControlAffinity.leading,
                  value: selected.contains(agent.key),
                  onChanged: (checked) => onChanged(agent.key, checked == true),
                ),
            ],
          ),
        ),
    ],
  );
}
