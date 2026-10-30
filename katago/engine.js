// 本手：瀏覽器內 KataGo 引擎轉接層（不需伺服器）
// 使用 katago-web（MIT）的 KataGoEngineClient：TF.js 直接讀取 .bin.gz 權重。
(function () {
  const BASE = new URL('.', document.currentScript ? document.currentScript.src : location.href).href;
  const MODELS = [
    { id: 'b10', label: '標準 b10（約 11 MB）', file: 'kata1-b10c128.bin.gz' },
    { id: 'b24', label: '輕量 lionffen b24c64（手機可用）', file: 'lionffen_b24c64.bin.gz' },
    { id: 'b40', label: '高強度 b40c256（約 170 MB，僅限電腦 WebGPU，很慢）', url: 'https://huggingface.co/ConnerXwolf/katago-models/resolve/main/kata1-b40c256-s11385575424-d2784196062.bin.gz', heavy: true },
    { id: 'custom', label: '自訂模型網址（.bin.gz）', file: '' }
  ];
  const LIB = BASE + 'lib/katago-web.js';
  let lib = null, client = null, loadedKey = '', loading = null, accel = '';

  async function getLib() {
    if (lib) return lib;
    try { lib = await import(LIB); } catch (e) { throw new Error('載入 KataGo 程式庫失敗：' + e.message + '。請確認 katago/lib/katago-web.js'); }
    if (!lib.KataGoEngineClient) throw new Error('katago-web.js 裡找不到 KataGoEngineClient，請用 build-legacy.mjs 重新建置');
    return lib;
  }
  function modelUrl(id, custom) {
    if (id === 'custom') { if (!custom) throw new Error('請填入自訂模型網址'); return new URL(custom, location.href).href; }
    const m = MODELS.find(x => x.id === id) || MODELS[0];
    return m.url || BASE + 'models/' + m.file;
  }
  async function check(url, what) {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
    if (!r || !r.ok) throw new Error('找不到' + what + '（HTTP ' + (r ? r.status : '網路錯誤') + '）：' + url);
    return +r.headers.get('content-length') || 0;
  }

  async function load(id, custom, onProgress, onStatus) {
    const url = modelUrl(id, custom), key = url;
    if (client && loadedKey === key) return client;
    if (loading && loading.key === key) return loading.p;
    const say = t => { if (onStatus) try { onStatus(t); } catch (e) {} };
    const p = (async () => {
      const L = await getLib();
      await check(BASE + 'lib/worker.js', ' katago/lib/worker.js');
      const mm = MODELS.find(x => x.id === id) || {};
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      if (mm.heavy && (!navigator.gpu || mobile)) throw new Error('b40c256 需要電腦版瀏覽器的 WebGPU（Chrome / Edge）；手機或不支援 WebGPU 的瀏覽器請改用 b10 或 b24');
      if (!mm.url) await check(url, '模型檔');
      const tries = mm.heavy ? ['webgpu'] : navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
      let lastErr;
      for (const a of tries) {
        if (client) { try { client.dispose(); } catch (e) {} }
        client = null; loadedKey = '';
        const c = new L.KataGoEngineClient();
        const off = c.onLoadProgress ? c.onLoadProgress(pr => {
          const f = pr && (pr.fraction ?? pr.progress);
          if (f != null && onProgress) try { onProgress(f); } catch (e) {}
          say('載入模型（' + a + '）' + (pr && pr.stage ? '：' + pr.stage : '') + (f != null ? ' ' + Math.round(f * 100) + '%' : '') + '…');
        }) : null;
        say('初始化引擎（' + a + '）…');
        let tm;
        try {
          await Promise.race([c.init(url, a), new Promise((_, rej) => { tm = setTimeout(() => rej(new Error(a + ' 初始化逾時')), mm.heavy ? 600000 : 180000); })]);
          clearTimeout(tm); off && off();
          client = c; accel = (c.getEngineInfo && c.getEngineInfo().backend) || a; loadedKey = key;
          say('引擎就緒（' + accel + '）'); return c;
        } catch (e) {
          clearTimeout(tm); off && off(); lastErr = e;
          console.warn('[本手 KataGo] ' + a + ' 失敗：', e);
          try { c.dispose(); } catch (x) {}
        }
      }
      throw new Error((lastErr && lastErr.message) || String(lastErr));
    })();
    loading = { key, p };
    try { return await p; } finally { loading = null; }
  }

  // board: N×N 陣列（[y][x]，y=0 為最上排），值為 'black' / 'white' / null；player: 'black' / 'white'
  async function analyze(q) {
    if (!client) throw new Error('引擎尚未載入');
    const N = q.board.length;
    const board = q.board.map(r => r.map(v => (v === 'black' || v === 'white') ? v : null));
    const rk = String(q.rules || '').toLowerCase();
    const rules = /jap|日/.test(rk) ? 'japanese' : /kor|韓/.test(rk) ? 'korean' : 'chinese';
    const r = await client.analyze({
      modelUrl: loadedKey, board, currentPlayer: q.player === 'white' ? 'white' : 'black',
      moveHistory: [], komi: q.komi ?? 7.5, rules,
      visits: Math.max(1, q.visits | 0 || 50), maxTimeMs: 60000, topK: 3, analysisPvLen: 1, ownershipMode: 'none'
    });
    const c = (r.moves || [])[0];
    let best = null;
    if (c) best = (c.x < 0 || c.y < 0 || c.x >= N || c.y >= N) ? 'PASS' : 'ABCDEFGHJKLMNOPQRST'[c.x] + (N - c.y);
    return { wr: Math.round(r.rootWinRate * 1000) / 10, lead: Math.round(r.rootScoreLead * 10) / 10, best };
  }

  window.WQKata = { MODELS, load, analyze, backend: () => accel || (navigator.gpu ? 'webgpu' : 'wasm'), loadedKey: () => loadedKey };
})();
