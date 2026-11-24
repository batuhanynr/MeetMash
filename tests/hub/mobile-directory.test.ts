import assert from 'node:assert/strict';
import test from 'node:test';
import { freshDatabase } from './helper.ts';
import { Directory } from '../../apps/hub/src/directory.ts';
import { PgDirectoryStore } from '../../apps/hub/src/pg-directory.ts';
import { provisionIdentity } from '../../apps/hub/src/pg-identity.ts';
import { MobileDirectoryControl } from '../../apps/hub/src/mobile-directory.ts';

test('only the intended recipient can accept a friend request and unlock friends visibility',async()=>{
  const db=await freshDatabase();
  try {
    const profiles=new PgDirectoryStore(db), directory=new Directory(profiles);
    const mobile=new MobileDirectoryControl(db,directory,id=>profiles.visibleProfiles(id));
    for(const agentId of ['alice','bob','carol']){
      await provisionIdentity(db,{agentId,userId:agentId,secret:'test-secret'});
      await mobile.handle(agentId,{kind:'profile.save',displayName:agentId,visibility:'public',capabilities:[]});
    }
    assert.equal((await mobile.handle('alice',{kind:'friends.request',target:'bob'}))?.requested,true);
    await mobile.handle('bob',{kind:'profile.save',displayName:'bob',visibility:'friends',capabilities:[]});
    assert.equal(await directory.lookup('alice','bob'),undefined);
    assert.deepEqual((await mobile.handle('alice',{kind:'directory.list'}))?.agents,[{agentId:'carol',displayName:'carol'}]);
    assert.equal((await mobile.handle('carol',{kind:'friends.accept',target:'alice'}))?.error,'NO_REQUEST');
    assert.deepEqual((await mobile.handle('bob',{kind:'friends.list'}))?.incoming,['alice']);
    assert.equal((await mobile.handle('bob',{kind:'friends.accept',target:'alice'}))?.accepted,true);
    assert.equal((await directory.lookup('alice','bob'))?.displayName,'bob');
    assert.equal(await directory.lookup('carol','bob'),undefined);
    assert.deepEqual((await mobile.handle('alice',{kind:'directory.list'}))?.agents,[
      {agentId:'bob',displayName:'bob'}, {agentId:'carol',displayName:'carol'},
    ]);
  }finally{await db.end();}
});
