// 本手：瀏覽器內 KataGo 引擎轉接層（不需伺服器）
// 依賴 katago-web（MIT）的 createEngine（Public Contract v1）。
(function () {
  const BASE = new URL('.', document.currentScript ? document.currentScript.src : location.href).href;
  const MODELS = [
    { id: 'b10', label: '標準 b10（約 11 MB）', file: 'kata1-b10c128.bin.gz' },
    { id: 'b24', label: '輕量 lionffen b24c64（手機可用）', file: 'lionffen_b24c64.bin.gz' },
    { id: 'custom', label: '自訂模型網址（.bin.gz）', file: '' }
  ];
  const LIBS = [BASE + 'lib/katago-web.js'];
  let lib = null, engine = null, loadedKey = '', loading = null, accel = '', seq = 0;

  async function getLib() {
    if (lib) return lib;
    let err;
    for (const u of LIBS) { try { lib = await import(u); if (lib.createEngine) return lib; } catch (e) { err = e; } }
    throw new Error('載入 KataGo 程式庫失敗' + (err ? '：' + err.message : '（找不到 createEngine）') + '。請確認 katago/lib/katago-web.js');
  }
  function modelUrl(id, custom) {
    if (id === 'custom') { if (!custom) throw new Error('請填入自訂模型網址'); return new URL(custom, location.href).href; }
    const m = MODELS.find(x => x.id === id) || MODELS[0];
    return BASE + 'models/' + m.file;
  }
  async function sha256(buf) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function fetchModel(url, onProgress) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('找不到模型檔（HTTP ' + r.status + '）：' + url);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total || !onProgress) return new Uint8Array(await r.arrayBuffer());
    const rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProgress(got / total); }
    const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function errMsg(e) { return (e && e.failure ? e.failure.code + '：' : '') + (e && e.message || String(e)); }

  async function load(id, custom, onProgress, onStatus) {
    const url = modelUrl(id, custom), key = url;
    if (engine && loadedKey === key) return engine;
    if (loading && loading.key === key) return loading.p;
    const p = (async () => {
      const L = await getLib();
      if (engine) { try { await engine.dispose(); } catch (e) {} }
      engine = null; loadedKey = '';
      const bytes = await fetchModel(url, onProgress);
      const hash = await sha256(bytes);
      const file = url.split('/').pop().split('?')[0] || 'model.bin.gz';
      const format = /\.bin\.gz$/i.test(file) ? 'katago-bin-gzip' : /\.bin$/i.test(file) ? 'katago-bin' : /\.onnx$/i.test(file) ? 'onnx' : null;
      if (!format) throw new Error('不支援的模型格式（需 .bin.gz）：' + file);
      const manifest = {
        schemaVersion: 1, modelId: file, sourceModelSha256: hash,
        variants: [{ variantId: 'main', format, entryPath: file,
          artifacts: [{ path: file, sha256: hash, byteLength: bytes.byteLength, source: { kind: 'bytes', bytes } }] }]
      };
      const say = t => { if (onStatus) try { onStatus(t); } catch (e) {} };
      const tries = navigator.gpu ? ['webgpu', 'wasm-cpu'] : ['wasm-cpu'];
      const STAGE = { fetch: '讀取模型', parse: '解析模型', compile: '編譯神經網路', warmup: '暖機' };
      let lastErr;
      for (const a of tries) {
        let failW = null;
        const wErr = new Promise((_, rej) => { failW = rej; });
        const eng = L.createEngine({ assetBaseUrl: BASE + 'worker/', workerFactory: () => {
          const w = new Worker(BASE + 'worker/coordinator.worker.js', { type: 'module' });
          w.addEventListener('error', ev => { ev.preventDefault && ev.preventDefault(); failW(new Error('引擎背景程式載入失敗（katago/worker/coordinator.worker.js）' + (ev.message ? '：' + ev.message : '，請確認此檔已上傳'))); });
          w.addEventListener('messageerror', () => failW(new Error('引擎背景程式訊息錯誤')));
          return w;
        } });
        const unsub = eng.subscribe(ev => {
          if (ev.type === 'load-progress') say('初始化引擎（' + a + '）：' + (STAGE[ev.stage] || ev.stage) + (ev.fraction != null ? ' ' + Math.round(ev.fraction * 100) + '%' : '') + '…');
          else if (ev.type === 'fault') failW(new Error(errMsg({ failure: ev.error, message: ev.error.message })));
        });
        say('初始化引擎（' + a + '）…');
        let tm;
        const timeout = new Promise((_, rej) => { tm = setTimeout(() => rej(new Error(a + ' 初始化逾時（90 秒沒有回應）')), 90000); });
        try {
          await Promise.race([eng.initialize({ operationId: 'load-' + (++seq), model: { kind: 'manifest', manifest }, runtime: { accelerator: a, fallback: 'forbid' } }), wErr, timeout]);
          clearTimeout(tm); engine = eng; accel = a; loadedKey = key; say('引擎就緒（' + a + '）'); return eng;
        } catch (e) {
          clearTimeout(tm); lastErr = e; console.warn('[本手 KataGo] ' + a + ' 失敗：', e);
          try { unsub(); } catch (x) {} try { await Promise.race([eng.dispose(), new Promise(r => setTimeout(r, 2000))]); } catch (x) {}
        }
      }
      throw new Error(errMsg(lastErr));
    })();
    loading = { key, p };
    try { return await p; } finally { loading = null; }
  }

  // board: N×N 陣列（[y][x]，y=0 為最上排），值為 'black' / 'white' / null；player: 'black' / 'white'
  async function analyze(q) {
    if (!engine) throw new Error('引擎尚未載入');
    const N = q.board.length, stones = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = q.board[y][x];
      if (v === 'black' || v === 'white') stones.push({ player: v, point: { x, y } });
    }
    const rk = String(q.rules || '').toLowerCase();
    const preset = /jap|日/.test(rk) ? 'japanese' : /kor|韓/.test(rk) ? 'korean' : 'chinese';
    const req = {
      apiVersion: 1, requestId: 'req-' + (++seq),
      position: {
        kind: 'game', dimensions: { width: N, height: N }, initialStones: stones,
        initialPlayer: q.player === 'white' ? 'white' : 'black', moves: [],
        rules: { kind: 'preset', name: preset }, komi: q.komi ?? 7.5,
        handicap: { countOverride: null, inferFromInitialBlackMoves: false }
      },
      search: { profile: 'upstream-analysis-v1', limits: { kind: 'visits', maxVisits: Math.max(1, q.visits | 0 || 50) },
        seed: null, batchSize: 'auto', searchThreads: 'auto', conservativePass: true, wideRootNoise: 0, rootSymmetrySamples: 1, allowedRootMoves: null },
      output: { maxCandidates: 3, pvLength: 1, includePolicy: false, ownership: 'none', includeOwnershipStdev: false, includeCandidateOwnership: false, progressIntervalMs: null }
    };
    let r, tm;
    try { r = await Promise.race([engine.analyze(req), new Promise((_, rej) => { tm = setTimeout(() => rej(new Error('單手分析逾時（120 秒）')), 120000); })]); }
    catch (e) { throw new Error(errMsg(e)); } finally { clearTimeout(tm); }
    const s = r.snapshot, ev = s.evaluation;
    const c = (s.candidates || [])[0];
    let best = null;
    if (c && c.move) best = c.move.kind === 'pass' ? 'PASS' : 'ABCDEFGHJKLMNOPQRST'[c.move.point.x] + (N - c.move.point.y);
    return { wr: Math.round(ev.blackWinRate * 1000) / 10, lead: Math.round(ev.blackScoreLead * 10) / 10, best };
  }

  window.WQKata = { MODELS, load, analyze, backend: () => accel || (navigator.gpu ? 'webgpu' : 'wasm-cpu'), loadedKey: () => loadedKey };
})();
