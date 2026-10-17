(() => {
  const DB_NAME = 'ronasentra-offline';
  const DB_VERSION = 1;
  const TABLES = ['accounts', 'customers', 'rentals'];
  let opening;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const table of TABLES) {
          if (!db.objectStoreNames.contains(table)) db.createObjectStore(table, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { opening = null; reject(request.error || new Error('Database lokal tidak dapat dibuka.')); };
      request.onblocked = () => reject(new Error('Database sedang digunakan pada tab lain. Tutup tab aplikasi lain lalu coba lagi.'));
    });
    return opening;
  }

  async function all(table) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readonly');
      const request = tx.objectStore(table).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Gagal membaca data.'));
    });
  }

  async function save(table, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      const request = tx.objectStore(table).put(value);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Gagal menyimpan data.'));
      tx.onabort = () => reject(tx.error || new Error('Penyimpanan dibatalkan.'));
    });
  }

  async function remove(table, id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, 'readwrite');
      tx.objectStore(table).delete(Number(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Gagal menghapus data.'));
      tx.onabort = () => reject(tx.error || new Error('Penghapusan dibatalkan.'));
    });
  }

  async function replaceAll(snapshot) {
    if (!snapshot || snapshot.format !== 'ronasentra-backup' || snapshot.version !== 1) throw new Error('Format cadangan tidak dikenali.');
    for (const table of TABLES) if (!Array.isArray(snapshot.data?.[table])) throw new Error(`Data ${table} pada cadangan tidak valid.`);
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TABLES, 'readwrite');
      for (const table of TABLES) {
        const store = tx.objectStore(table);
        store.clear();
        for (const item of snapshot.data[table]) {
          if (!item || !Number.isInteger(Number(item.id)) || Number(item.id) < 1) { tx.abort(); reject(new Error(`Ada ID ${table} yang tidak valid.`)); return; }
          store.put(item);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Gagal memulihkan cadangan.'));
      tx.onabort = () => reject(tx.error || new Error('Pemulihan cadangan dibatalkan.'));
    });
  }

  window.LocalDB = { all, save, remove, replaceAll };
})();
