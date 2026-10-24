/** Trusted worker entrypoints, not browser code. `actions` must be a platform-bound
 * worker RPC (system:worker); ownerActions must bind the authenticated owner.
 * Adapters hold private store credentials and must verify exact-scope absence.
 * No timer, cron handler, or age-based eligibility exists in this module.
 */
const stores = ['r2', 'index', 'd1'] // Preserve attachment inventory until R2 finishes.
const rows = result => result?.rows ?? result?.results?.[0]?.rows ?? []
const callRows = async (actions,name,p) => rows(await actions(name,p))
const scopeOf = s => {
  if (!s || !['organization_id','brand_id'].every(k=>typeof s[k]==='string' && s[k].length>0 && s[k].length<=128)) throw Error('Exact organization and brand required')
  return {organization_id:s.organization_id,brand_id:s.brand_id}
}
const id = v => { if(typeof v!=='string'||!v||v.length>512)throw Error('Invalid operation identity');return v }
const resultCode = outcome => ({complete:'verified_absent',failed:'retryable',blocked:'adapter_unavailable',unknown:'unconfirmed'})[outcome]

export async function executeStoreDeletion({actions,adapters={},scope,requestId,newId=()=>crypto.randomUUID()}) {
  const base={...scopeOf(scope),request_id:id(requestId)}
  const check=await callRows(actions,'check_store_hold',base)
  if(check.length!==1) throw Error('Deletion request unavailable')
  if(check[0].held) return {state:'held',steps:await callRows(actions,'worker_get_store_deletion',base)}
  for(const store of stores) {
    const current=(await callRows(actions,'worker_get_store_deletion',base)).find(s=>s.store===store)
    if(!current || current.state==='complete')continue
    // Never reclaim running/unknown work on elapsed time or repeat its delete call.
    if(['running','unknown'].includes(current.state))continue
    const attempt_id=id(newId())
    const p={...base,store,attempt_id}
    try { await actions('claim_store_deletion',p) } catch { /* Lost claim response: read durable identity. */ }
    const attempt=await callRows(actions,'get_store_deletion_attempt',p)
    if(attempt.length!==1 || attempt[0].state!=='running')continue
    const target=Object.freeze({...base,candidate_id:attempt[0].candidate_id,application_id:attempt[0].application_id,attempt_id})
    let outcome='blocked',reason_code='adapter_unavailable'
    const adapter=adapters[store]
    if(adapter?.remove && adapter?.verify) {
      try {
        await adapter.remove(target)
        const verification=await adapter.verify(target)
        if(verification===true) {outcome='complete';reason_code='verified_absent'}
        else if(verification==='protected_records') {outcome='blocked';reason_code='protected_records'}
        else {outcome='failed';reason_code='retryable'}
      } catch {outcome='unknown';reason_code='unconfirmed'}
    }
    // If persistence fails, keep the running interlock and reconcile; never report success.
    await actions('finish_store_deletion',{...p,outcome,reason_code})
  }
  const steps=await callRows(actions,'worker_get_store_deletion',base)
  return {state:steps.length===3 && steps.every(s=>s.state==='complete')?'complete':'partial',steps}
}

/** Only an adapter's definitive settled/absent readback can unlock uncertainty. */
export async function reconcileStoreDeletion({actions,adapter,scope,requestId,store,attemptId}) {
  if(!stores.includes(store))throw Error('Invalid store')
  const p={...scopeOf(scope),request_id:id(requestId),store,attempt_id:id(attemptId)}
  const attempt=await callRows(actions,'get_store_deletion_attempt',p)
  if(attempt.length!==1)throw Error('Attempt unavailable')
  if(!adapter?.reconcile)return 'unknown'
  let settled
  try {settled=await adapter.reconcile(Object.freeze({...p,candidate_id:attempt[0].candidate_id,application_id:attempt[0].application_id}))} catch {return 'unknown'}
  // `not_deleted` means no provider operation remains in flight, not merely head()!=null.
  const outcome=settled==='absent'?'complete':settled==='not_deleted'?'failed':'unknown'
  await actions('finish_store_deletion',{...p,outcome,reason_code:resultCode(outcome)})
  return outcome
}

export function createD1DeletionAdapter(actions) {
  return {
    remove:target=>actions('purge_store_d1',target),
    verify:async target=>{
      const report=await callRows(actions,'verify_store_d1',target)
      return report.length===1 && Number(report[0].remaining_records)===0 ? true : 'protected_records'
    }
  }
}

/** `bucket` is a trusted scoped R2-compatible binding, never supplied by a caller.
 * Inventory comes from authenticated SQL, not keys submitted by the browser.
 */
async function storeAuthority(actions,target,store) {
  const p={...scopeOf(target),request_id:id(target.request_id),store,attempt_id:id(target.attempt_id)}
  const attempts=await callRows(actions,'get_store_deletion_attempt',p)
  const holds=await callRows(actions,'check_store_hold',p)
  if(attempts.length!==1||attempts[0].state!=='running'||holds.length!==1||holds[0].held)throw Error('Store deletion is not authorized')
  return {...p,candidate_id:attempts[0].candidate_id}
}
export function createR2DeletionAdapter({actions,bucket}) {
  const inventory=async function*(target) {
    let after_id=null
    for(;;) {
      const page=await callRows(actions,'list_deletion_objects',{...target,after_id})
      for(const object of page)yield object
      if(page.length<100)return
      after_id=page.at(-1).id
    }
  }
  return {
    async remove(target) {await storeAuthority(actions,target,'r2');for await(const object of inventory(target))await bucket.delete(object.storage_path)},
    async verify(target) {for await(const object of inventory(target))if(await bucket.head(object.storage_path))return false;return true}
  }
}

/** Index service must enforce all three predicates server-side. Missing capability
 * is blocked by the executor; SQL search projections need no fabricated index API.
 */
export function createIndexDeletionAdapter({actions,index}) {
  const filter=t=>({organization_id:t.organization_id,brand_id:t.brand_id,candidate_id:t.candidate_id})
  return {remove:async t=>index.deleteByScope(filter(await storeAuthority(actions,t,'index'))),verify:async t=>(await index.countByScope(filter(await storeAuthority(actions,t,'index'))))===0}
}

const encoder=new TextEncoder()
const bytesToHex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
const digest=async body=>bytesToHex(await crypto.subtle.digest('SHA-256',encoder.encode(body)))
const keyFor=secret=>{
  if(typeof secret!=='string'||encoder.encode(secret).length<32)throw Error('A private ledger signing key of at least 32 bytes is required')
  return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])
}

/** Private, authenticated export; persist outside the backup, with restricted access.
 * Counts before/after detect concurrent append-only ledger changes; retry the export.
 */
export async function exportRetentionLedger({ownerActions,scope,secret}) {
  const s=scopeOf(scope)
  const before=await callRows(ownerActions,'retention_ledger_watermark',s)
  if(before.length!==1)throw Error('Ledger export unavailable')
  const tombstones=[];let after_id=null
  for(;;) {
    const page=await callRows(ownerActions,'export_retention_tombstones',{...s,after_id})
    tombstones.push(...page)
    if(page.length<100)break
    after_id=page.at(-1).request_id
  }
  for(const t of tombstones) {
    t.objects=[];let cursor=null
    for(;;) {
      const page=await callRows(ownerActions,'export_retention_objects',{...s,request_id:t.request_id,after_id:cursor})
      t.objects.push(...page)
      if(page.length<100)break
      cursor=page.at(-1).id
    }
  }
  const holds=[]
  for(const ledger of ['legacy','stores']) {
    let after_sequence=null
    for(;;) {
      const page=await callRows(ownerActions,'export_retention_holds',{...s,ledger,after_sequence})
      holds.push(...page.map(h=>({...h,ledger})))
      if(page.length<100)break
      after_sequence=page.at(-1).sequence
    }
  }
  let replayCursor=null
  for(;;) {
    const page=await callRows(ownerActions,'export_replayed_retention_holds',{...s,after_id:replayCursor})
    holds.push(...page.map(({cursor,...h})=>h))
    if(page.length<100)break
    replayCursor=page.at(-1).cursor
  }
  const uniqueHolds=new Map()
  for(const h of holds) {
    const identity=h.ledger+':'+h.sequence
    const prior=uniqueHolds.get(identity)
    if(prior && Object.keys(prior).some(k=>prior[k]!==h[k]))throw Error('Conflicting restored hold ledger')
    uniqueHolds.set(identity,h)
  }
  const after=await callRows(ownerActions,'retention_ledger_watermark',s)
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Ledger changed during export; retry')
  const body=JSON.stringify({version:1,scope:s,tombstones,holds:[...uniqueHolds.values()]})
  const signature=bytesToHex(await crypto.subtle.sign('HMAC',await keyFor(secret),encoder.encode(body)))
  return {body,signature}
}

/** A replay is allowed only into a gate-controlled isolated destination. The gate
 * must disable reads, writes, intake and dispatch and survive process restarts.
 * This module never reopens it. Operators separately authorize reopening after
 * ready, full inventory verification and processor/queue reconciliation.
 */
export async function replayRetentionLedger({actions,adapters,scope,restoreId,artifact,secret,gate}) {
  const s=scopeOf(scope);id(restoreId)
  if(!artifact || typeof artifact.body!=='string' || artifact.body.length>10_000_000 || !/^[a-f0-9]{64}$/.test(artifact.signature??''))throw Error('Invalid ledger')
  const signature=Uint8Array.from(artifact.signature.match(/../g),b=>parseInt(b,16))
  if(!await crypto.subtle.verify('HMAC',await keyFor(secret),signature,encoder.encode(artifact.body)))throw Error('Ledger signature invalid')
  const ledger=JSON.parse(artifact.body)
  if(ledger.version!==1||JSON.stringify(ledger.scope)!==JSON.stringify(s)||!Array.isArray(ledger.tombstones)||!Array.isArray(ledger.holds))throw Error('Ledger scope invalid')
  for(const item of [...ledger.tombstones,...ledger.holds])if(item.organization_id!==s.organization_id||item.brand_id!==s.brand_id)throw Error('Ledger item scope invalid')
  if(!gate?.close||!gate?.isClosed)throw Error('A durable closed restore gate is required')
  await gate.close(s,restoreId)
  const closed=async()=>{if(await gate.isClosed(s,restoreId)!==true)throw Error('Restore gate is not closed')}
  await closed()
  const base={...s,restore_id:restoreId,digest:await digest(artifact.body)}
  if(!gate.assertLatestDigest || await gate.assertLatestDigest(s,base.digest)!==true)throw Error('Latest independent ledger checkpoint required')
  let status=await callRows(actions,'get_retention_restore',base)
  if(status.length===0) {
    await actions('begin_retention_restore',{...base,tombstone_count:ledger.tombstones.length,hold_count:ledger.holds.length})
    status=await callRows(actions,'get_retention_restore',base)
    if(status.length!==1)throw Error('Restore manifest conflicts with existing session')
  }
  if(status[0].state==='importing') {
    for(const h of ledger.holds) {await closed();await actions('import_retention_hold',{...h,...base})}
    for(const t of ledger.tombstones) {
      await closed();await actions('import_retention_tombstone',{...t,...base})
      if(!Array.isArray(t.objects))throw Error('Signed object inventory missing')
      for(const object of t.objects)await actions('import_retention_object',{...s,request_id:restoreId+':'+t.request_id,object_id:object.id,storage_path:object.storage_path})
    }
    await actions('seal_retention_restore',base)
    status=await callRows(actions,'get_retention_restore',base)
    if(status[0]?.state!=='replaying')throw Error('Restore ledger import incomplete')
  }
  // A ready session may be read again; a new physical restore MUST use a fresh ID.
  if(status[0].state!=='ready')for(const t of ledger.tombstones) {
    await closed()
    await executeStoreDeletion({actions,adapters,scope:s,requestId:restoreId+':'+t.request_id})
  }
  await closed()
  await actions('finish_retention_restore',base)
  status=await callRows(actions,'get_retention_restore',base)
  return {state:status[0]?.state==='ready'?'ready':'blocked',access:'closed',restoreId}
}
