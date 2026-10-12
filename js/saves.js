// Saved games and replays in this browser (localStorage). A save is a command log, not a memory dump: setup (seed,
// players, civilizations, AI personalities) + every player command with its tick. Loading replays the log at full
// speed (the simulation is deterministic); watching it at normal speed is the replay.
const IDX = 'ak_saves', KEY = (id) => 'ak_save_' + id, MAX = 20;

export const Saves = {
  list() { try { return JSON.parse(localStorage.getItem(IDX) || '[]'); } catch { return []; } },
  get(id) { try { return JSON.parse(localStorage.getItem(KEY(id))); } catch { return null; } },
  // slot 'auto' = the autosave; anything else gets a fresh id. Returns the id, or null when storage is full.
  put(slot, meta, rec) {
    const id = slot === 'auto' ? 'auto' : slot || 's' + Date.now().toString(36);
    const data = JSON.stringify(rec);
    for (let k = 0; k < 6; k++) {
      try {
        localStorage.setItem(KEY(id), data);
        const l = this.list().filter(x => x.id !== id); l.unshift({ id, ...meta, size: data.length });
        localStorage.setItem(IDX, JSON.stringify(l.slice(0, MAX)));
        return id;
      } catch {           // full: drop the oldest manual save and try again
        const l = this.list(), old = l.filter(x => x.id !== 'auto' && x.id !== id).pop(); if (!old) return null; this.del(old.id);
      }
    }
    return null;
  },
  del(id) { try { localStorage.removeItem(KEY(id)); localStorage.setItem(IDX, JSON.stringify(this.list().filter(x => x.id !== id))); } catch { } },
  // a file to keep or share
  download(id) {
    const rec = this.get(id), meta = this.list().find(x => x.id === id); if (!rec) return;
    const blob = new Blob([JSON.stringify({ meta, rec })], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `abad-kerajaan-${(meta && meta.map || 'permainan').toLowerCase().replace(/\W+/g, '-')}-${id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async upload(file) {
    const o = JSON.parse(await file.text());
    if (!o || !o.rec || !o.rec.setup || !Array.isArray(o.rec.cmds)) throw new Error('Bukan file simpanan Abad Kerajaan');
    return this.put(null, { ...(o.meta || {}), kind: (o.meta && o.meta.kind) || 'replay', date: Date.now(), imported: true }, o.rec);
  },
};
