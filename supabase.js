'use strict';

const Cloud = {
  _url: 'https://fkizqvhgkqhjmzbuufcr.supabase.co',
  _key: 'sb_publishable_IXsZC_7OdHAq08BtPTrjJw_wGvpF96z',

  _h() {
    return {
      'apikey': this._key,
      'Authorization': 'Bearer ' + this._key,
      'Content-Type': 'application/json'
    };
  },

  async push(id, data) {
    try {
      await fetch(this._url + '/rest/v1/store', {
        method: 'POST',
        headers: Object.assign({}, this._h(), { 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify({ id, data })
      });
    } catch(e) { console.warn('Cloud push:', e.message); }
  },

  async pull() {
    try {
      const res = await fetch(this._url + '/rest/v1/store?select=id,data', {
        headers: this._h()
      });
      if (!res.ok) return false;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return false;
      rows.forEach(row => {
        localStorage.setItem(row.id, JSON.stringify(row.data));
      });
      return true;
    } catch(e) {
      console.warn('Cloud pull:', e.message);
      return false;
    }
  }
};
