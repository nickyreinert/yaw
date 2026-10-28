import { randomBytes } from 'node:crypto';
import { validateVault } from '../lib/data-sync.js';
import { readUserData, writeUserData } from '../lib/user-store.js';
import { digest, identifier, requireValue } from './store.js';

export function createHub({ store, env, kitRoot }) {
  let data = readUserData(env, 'remote-hub.json') ?? { schema: 1, revision: 0, records: {}, devices: {}, receipts: {} };
  requireValue(data.schema === 1, 'Unsupported hub schema');
  const commit = (next) => {
    requireValue(Buffer.byteLength(JSON.stringify(next)) <= 16 * 1024 * 1024, 'Hub storage limit reached; archive the dataset before adding records', 413);
    writeUserData(env, 'remote-hub.json', next); data = next;
  };
  const view = () => ({ schema: 1, revision: data.revision, records: data.records, devices: data.devices });
  return {
    view,
    pair(name) {
      requireValue(typeof name === 'string' && /^[\p{L}\p{N} _.-]{1,64}$/u.test(name), 'Give a device name');
      requireValue(store.state.devices.length < 100, 'Device limit reached');
      const token = randomBytes(32).toString('hex'), device = { id: identifier(), name, hash: digest(token), revoked: false };
      store.state.devices.push(device); store.save(); return { id: device.id, token };
    },
    authenticate(token) { if (typeof token !== 'string' || token.length !== 64) return null; return store.state.devices.find((d) => !d.revoked && d.hash === digest(token)) ?? null; },
    devices() { return store.state.devices.map(({ id, name, revoked }) => ({ id, name, revoked })); },
    revoke(id) { const d = store.state.devices.find((x) => x.id === id); requireValue(d, 'Unknown device'); d.revoked = true; store.save(); },
    import(vault) {
      requireValue(data.revision === 0 && !Object.keys(data.records).length, 'Import is only allowed into an empty hub', 409);
      const v = validateVault(structuredClone(vault), kitRoot);
      commit({ schema: 1, revision: 1, records: v.records, devices: v.devices, receipts: {} }); return view();
    },
    exchange(device, input) {
      requireValue(input?.schema === 1 && Number.isSafeInteger(input.revision) && /^[A-Za-z0-9_-]{8,100}$/.test(input.commandId), 'Unsupported hub request');
      const key = digest(`${device.id}:${input.commandId}`), fingerprint = digest(JSON.stringify(input));
      if (data.receipts[key]) { requireValue(data.receipts[key] === fingerprint, 'Command ID reused', 409); return { ...view(), deviceId: device.id, duplicate: true }; }
      requireValue(input.revision === data.revision, 'Revision conflict; fetch the hub and merge again', 409);
      requireValue(Object.keys(data.receipts).length < 20000, 'Hub receipt limit reached', 409);
      const validated = validateVault({ version: 1, records: input.records, devices: { [device.id]: input.device } }, kitRoot);
      // Missing records mean unchanged, explicit null values are deletion markers.
      commit({ ...data, revision: data.revision + 1, records: { ...data.records, ...validated.records }, devices: { ...data.devices, ...validated.devices }, receipts: { ...data.receipts, [key]: fingerprint } });
      return { ...view(), deviceId: device.id };
    },
  };
}
