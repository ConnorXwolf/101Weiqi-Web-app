// 本手：瀏覽器內 KataGo 引擎轉接層（不需伺服器）
// 依賴 katago-web（MIT）的 KataGoEngineClient。先找 katago/lib/katago-web.js（自行建置），找不到再用 CDN。
(function () {
  const BASE = new URL('.', document.currentScript ? document.currentScript.src : location.href).href;
  const MODELS = [
    { id: 'b10', label: '標準 b10（約 11 MB）', file: 'kata1-b10c128.bin.gz' },
    { id: 'b6', label: '輕量 b6（手機可用）', file: 'kata1-b6c96-s175395328-d26788732.txt.gz' },
    { id: 'custom', label: '自訂模型網址', file: '' }
  ];
  const LIBS = [BASE + 'lib/katago-web.js', 'https://esm.sh/gh/JuneKim0712/katago-web/src/index.ts'];
  let lib = null, client = null, loadedKey = '', loading = null;

  async function getLib() {
    if (lib) return lib;
    let err;
    for (const u of LIBS) { try { lib = await import(u); if (lib.KataGoEngineClient) return lib; } catch (e) { err = e; } }
    throw new Error('載入 KataGo 程式庫失敗' + (err ? '：' + err.message : '') + '。請依「katago/配置步驟.md」放入 katago/lib/katago-web.js');
  }
  function modelUrl(id, custom) {
    if (id === 'custom') { if (!custom) throw new Error('請填入自訂模型網址'); return custom; }
    const m = MODELS.find(x => x.id === id) || MODELS[1];
    return BASE + 'models/' + m.file;
  }
  function backend() { return navigator.gpu ? 'webgpu' : 'wasm'; }

  async function load(id, custom, onProgress) {
    const url = modelUrl(id, custom), key = url;
    if (client && loadedKey === key) return client;
    if (loading && loading.key === key) return loading.p;
    const p = (async () => {
      const L = await getLib();
      if (client && client.dispose) { try { await client.dispose(); } catch (e) {} }
      client = null; loadedKey = '';
      const c = new L.KataGoEngineClient();
      let be = backend();
      try { await c.init({ modelUrl: url, backend: be }); }
      catch (e) { if (be !== 'wasm') { be = 'wasm'; await c.init({ modelUrl: url, backend: be }); } else throw e; }
      client = c; loadedKey = key; client.__backend = be; return c;
    })();
    loading = { key, p };
    try { return await p; } finally { loading = null; }
  }

  // board: N×N 陣列（[y][x]），值為 'black' / 'white' / null；player: 'black' / 'white'
  async function analyze(q) {
    if (!client) throw new Error('引擎尚未載入');
    const r = await client.analyze({ board: q.board, currentPlayer: q.player, rules: q.rules, komi: q.komi, visits: q.visits });
    const root = r.rootInfo || r.root || r;
    let wr = root.rootWinRate ?? root.winrate ?? root.winRate ?? r.winrate;
    let lead = root.scoreLead ?? root.rootScoreLead ?? root.scoreMean ?? r.scoreLead;
    if (wr == null) throw new Error('引擎回傳格式不符');
    if (wr <= 1) wr *= 100;
    const top = (r.moves || r.moveInfos || [])[0] || {};
    let best = top.move ?? top.gtp ?? top.name ?? null;
    if (best && typeof best === 'object' && best.x != null) best = 'ABCDEFGHJKLMNOPQRST'[best.x] + (q.board.length - best.y);
    // 轉成黑方視角
    if (q.player === 'white') { wr = 100 - wr; if (lead != null) lead = -lead; }
    return { wr: Math.round(wr * 10) / 10, lead: lead == null ? null : Math.round(lead * 10) / 10, best: best ? String(best).toUpperCase() : null };
  }

  window.WQKata = { MODELS, load, analyze, backend: () => client ? client.__backend : backend(), loadedKey: () => loadedKey };
})();
