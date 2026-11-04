import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync(':memory:');
database.exec('SELECT 1');
database.close();
console.log(`Node ${process.version}; SQLite available; platform ${process.platform}/${process.arch}`);
for (const [command, args] of [['npm', ['--version']], ['flutter', ['--version']], ['flutter', ['doctor', '-v']]] as const) {
  const result = spawnSync(command, [...args], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exitCode = 1;
}
