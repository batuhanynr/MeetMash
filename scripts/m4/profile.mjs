import { execFileSync } from 'node:child_process';
const [project, profile] = process.argv.slice(2);
if (!/^meetmesh-m4-[a-f0-9]{8}$/.test(project ?? '') || !['N0', 'N1', 'N2', 'reset'].includes(profile))
  throw new Error('Expected a running meetmesh-m4-<id> project and N0/N1/N2/reset');
for (const name of ['hub', 'agent-a', 'agent-b', 'agent-c']) {
  const container = execFileSync(
    'docker',
    [
      'ps',
      '--filter',
      'label=com.docker.compose.project=' + project,
      '--filter',
      'label=com.docker.compose.service=' + name,
      '--format',
      '{{.ID}}',
    ],
    { encoding: 'utf8' },
  ).trim();
  if (!/^[a-f0-9]{12}$/.test(container)) throw new Error('Expected one running lab ' + name);
  execFileSync(
    'docker',
    ['exec', container, 'sh', 'infra/network/profile.sh', name === 'hub' ? 'agent-a' : 'hub-data', profile],
    { stdio: 'inherit' },
  );
}
