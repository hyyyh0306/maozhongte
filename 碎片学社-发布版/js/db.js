/* IndexedDB 轻量封装：stores: srs(学习进度) todo(待办) meta(设置/打卡/自定义题库) */
const DB = {
  _db: null,
  NAME: 'suipianxueshe',
  VER: 1,

  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.NAME, this.VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('srs')) d.createObjectStore('srs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('todo')) d.createObjectStore('todo', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  async _req(store, mode, fn) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, mode);
      const s = tx.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  get(store, key) { return this._req(store, 'readonly', (s) => s.get(key)); },
  getAll(store) { return this._req(store, 'readonly', (s) => s.getAll()); },
  put(store, val) { return this._req(store, 'readwrite', (s) => s.put(val)); },
  del(store, key) { return this._req(store, 'readwrite', (s) => s.delete(key)); },
  clear(store) { return this._req(store, 'readwrite', (s) => s.clear()); }
};
