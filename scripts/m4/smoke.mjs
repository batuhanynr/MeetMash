import { Lab, build } from './lab.mjs';
import assert from 'node:assert/strict';
const image = process.env.M4_IMAGE ?? 'meetmesh-m4:local';
build(image);
const lab = new Lab(image);
try {
  const linux = await lab.open();
  await lab.start('link-smoke');
  assert.equal(await lab.call('agent-c', 'health'), true);
  const applied = await lab.call('agent-c', 'profile', { profile: 'cut' });
  await assert.rejects(lab.call('agent-c', 'health'), /timed out/);
  const management = await lab.call('agent-c', 'info');
  const counters = await lab.call('agent-c', 'profile', { profile: 'show' });
  const reset = await lab.call('agent-c', 'profile', { profile: 'reset' });
  assert.equal(await lab.call('agent-c', 'health'), true);
  console.log(
    JSON.stringify(
      {
        environment: 'local Linux containers on Docker',
        linux,
        management,
        dataCut: applied,
        counters,
        reset,
        dataRestored: true,
      },
      null,
      2,
    ),
  );
} finally {
  await lab.close();
}
