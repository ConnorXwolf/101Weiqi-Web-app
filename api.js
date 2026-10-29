// 本手-棋力追蹤 data layer (personal). window.WQBoot() returns the Supabase API or an in-memory demo.
window.WQIsDemo = () => { if (/[?&]demo=1\b/.test(location.search) || (location.hash || '').includes('demo')) return true; const u = (window.WQ_CONFIG || {}).url; return !u || /YOUR-PROJECT/.test(u); };
window.WQBoot = function () {
  if (window.WQAPI) return window.WQAPI;
  const cfg = window.WQ_CONFIG || {};
  const DAY = 864e5;
  const T0 = (() => { const n = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' })); n.setHours(0, 0, 0, 0); return n.getTime(); })();
  const iso = d => { const x = new Date(T0 - d * DAY); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const demo = window.WQIsDemo();
  if (!demo && !window.supabase) throw new Error('supabase-js 沒有載入');

  function RealAPI() {
    const base = String(cfg.url).trim().replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');
    const sb = window.supabase.createClient(base, String(cfg.anonKey).trim());
    const emailOf = c => c.toLowerCase() + '@code.benshou.app';
    const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    const uid = async () => { const { data } = await sb.auth.getSession(); return data.session && data.session.user.id; };
    const api = {
      demo: false,
      async visit() { try { const vid = () => { let v = localStorage.getItem('wq_vid'); if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('wq_vid', v); } return v; };
 const { data, error } = await sb.rpc('log_visit', { p_visitor: vid() }); return error ? null : data; } catch (e) { return null; } },
      async current() { const id = await uid(); if (!id) return null; return chk(await sb.from('profiles').select('*').eq('id', id).single()); },
      async signIn(code) {
        const { error } = await sb.auth.signInWithPassword({ email: emailOf(code), password: code });
        if (error) throw new Error(/invalid login/i.test(error.message) ? '找不到這組登入代碼' : error.message);
        return api.current();
      },
      async myCode() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user.email.split('@')[0].toUpperCase() : ''; },
      async signOut() { await sb.auth.signOut(); },
      async rows(since) {
        const id = await uid(); let out = [];
        for (let from = 0; ; from += 1000) {
          const d = chk(await sb.from('attempts_v').select('*').eq('student_id', id).gte('task_day', since)
            .order('task_day').order('task_id').order('idx').range(from, from + 999));
          out = out.concat(d);
          if (d.length < 1000) break;
        }
        return out;
      },
      async logs() { const id = await uid(); return chk(await sb.from('sync_logs').select('*').eq('student_id', id).order('created_at', { ascending: false }).limit(20)); },
      async saveProfile(patch) { const id = await uid(); chk(await sb.from('profiles').update(patch).eq('id', id)); },
      async setOverride(problem_id, levelname, qtypename) {
        const id = await uid();
        chk(await sb.from('problem_overrides').upsert({ student_id: id, problem_id, levelname, qtypename, edited_at: new Date().toISOString() }));
      },
      async clearOverride(problem_id) { const id = await uid(); chk(await sb.from('problem_overrides').delete().eq('student_id', id).eq('problem_id', problem_id)); },
      async games() { const id = await uid(); return chk(await sb.from('games').select('*').eq('student_id', id).order('played_on', { ascending: false }).order('created_at', { ascending: false })); },
      async saveGame(g) {
        const id = await uid();
        const row = { student_id: id, fox_id: g.fox_id || null, played_on: g.played_on, info: g.info, points: g.points, sgf: g.sgf || null, updated_at: new Date().toISOString() };
        if (g.id) row.id = g.id;
        return chk(await sb.from('games').upsert(row).select().single());
      },
      async deleteGame(gid) { chk(await sb.from('games').delete().eq('id', gid)); },
      async fox(body) {
        const { data: ss } = await sb.auth.getSession();
        const key = String(cfg.anonKey).trim(), tok = (ss && ss.session && ss.session.access_token) || key;
        const call = region => fetch(base + '/functions/v1/fox', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + tok }, region ? { 'x-region': region } : {}), body: JSON.stringify(body) });
        if (body.action !== 'user') {
          // 野狐在部分地區連不上：依序換 Supabase 執行地區重試
          let last = null;
          for (const rg of [null, 'ap-northeast-1', 'ap-southeast-1', 'ap-northeast-2', 'us-west-1']) {
            try { const rr = await call(rg); const d = JSON.parse(await rr.text()); if (d && (d.result === 0 || d.result === '0')) return d; last = d; } catch (e) { last = { result: -1, resultstr: e.message }; }
          }
          if (last) return last;
        }
        let r;
        try { r = await call(null); }
        catch (e) { throw new Error('野狐連線失敗：無法連到 fox 函式。請在瀏覽器開啟 ' + base + '/functions/v1/fox 檢查：顯示「Requested function was not found」代表還沒部署或名稱不是 fox；顯示 401 代表要關掉該函式的「Verify JWT」。'); }
        const t = await r.text();
        if (r.status === 404) throw new Error('找不到 fox 函式：請確認 Edge Function 名稱是 fox 並已部署。');
        if (r.status === 401) throw new Error('fox 函式拒絕連線（401）：到 Edge Functions → fox → Details，關掉「Verify JWT with legacy secret」後按 Save。');
        if (!r.ok) throw new Error('fox 函式錯誤（HTTP ' + r.status + '）：' + t.slice(0, 120));
        try { return JSON.parse(t); } catch { throw new Error('fox 函式回傳格式錯誤：' + t.slice(0, 120)); }
      }
    };
    return api;
  }

  function DemoAPI() {
    const rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const RAW = ['死活題', '對殺題', '吃子題', '官子題', '手筋題'];
    const me = { id: 'me', display_name: '林子晴', level: '11K', wq_username: 'zq_lin', last_synced_at: new Date(Date.now() - 3 * 3600e3).toISOString(),
      settings: { acc: 90, n: 100, fast: 8, slow: 20 }, type_map: {}, use_fallback: true, email: 'demo@demo' };
    let signedIn = false, cache = null; const overrides = {};
    const ME = '関羽zero', OPP = ['風之谷', '青竹', 'kata練習', '小飛象', '星位控', '白鶴', '一間跳'];
    const foxList = Array.from({ length: 20 }, (_, i) => { const meB = i % 2 === 0, opp = OPP[i % OPP.length], win = (i * 7) % 3 !== 0;
      return { chessid: '1797' + String(100 + i), blacknick: meB ? ME : opp, whitenick: meB ? opp : ME, starttime: iso(Math.floor(i * 1.6)) + ' ' + String(19 + (i % 4)) + ':1' + (i % 6),
        movenum: 150 + (i * 13) % 110, winner: (meB === win) ? 1 : 2, reason: i % 3 === 0 ? 1 : 4, point: i % 3 === 0 ? 2.75 : 0 }; });
    function fakeSgf(seed, it) {
      const r = rng(seed * 97 + 5), L = 'abcdefghijklmnopqrs', used = new Set(), pts = [[3, 3], [15, 15], [15, 3], [3, 15], [2, 9], [16, 9], [9, 2], [9, 16]];
      const re = it.reason === 4 ? (it.winner === 1 ? 'B+R' : 'W+R') : (it.winner === 1 ? 'B+' : 'W+') + it.point;
      let s = '(;GM[1]FF[4]SZ[19]PB[' + it.blacknick + ']PW[' + it.whitenick + ']BR[3段]WR[3段]KM[375]HA[0]RU[Chinese]TM[600]DT[' + it.starttime.slice(0, 10) + ']RE[' + re + ']';
      let lx = 3, ly = 3;
      for (let i = 0; i < it.movenum; i++) {
        let x, y, k = 0;
        do { if (i < pts.length) [x, y] = pts[i]; else { x = Math.max(0, Math.min(18, lx + Math.round((r() - .5) * 6))); y = Math.max(0, Math.min(18, ly + Math.round((r() - .5) * 6))); if (k++ > 30) { x = Math.floor(r() * 19); y = Math.floor(r() * 19); } } } while (used.has(x + ',' + y));
        used.add(x + ',' + y); lx = x; ly = y; s += ';' + (i % 2 ? 'W' : 'B') + '[' + L[x] + L[y] + ']';
      }
      return s + ')';
    }
    const demoGames = [
      { id: 'g1', fox_id: null, played_on: '2026-10-25', sgf: null, points: [], info: { venue: '棋院', opponent: '珈銓', handicap: 0, time: '無計時', result: '勝', source: '老師', rules: '中國',
        reason: '珈銓布局方向錯誤，被我佔盡邊角。接著往中腹的速度又比我慢，且沒有打入我的空。而我有守好我的地盤，同時保持棋型的聯絡。' } },
      { id: 'g2', fox_id: '1797101', played_on: iso(1), sgf: fakeSgf(101, foxList[1]), info: { venue: '野狐', opponent: '青竹', my_color: '白', black_rank: '3D', white_rank: '3D', rules: '中國', komi: '3.75', handicap: 0, time: '10 分', result: '負', end: '中盤勝', reason: '右下死活算錯，大龍被殺。', self_moves: '87, 112, 140', source: 'AI', takeaway: '對殺前先數氣。' },
        points: [{ id: 'p1', move_no: 88, my_move: 'R5', correct: 'S4', loss: 32, thought: '以為可以先補外面。', type: '死活計算', in_self: true },
          { id: 'p2', move_no: 112, my_move: 'K10', correct: 'M3', loss: 12, thought: '', type: '方向或大小判斷', in_self: true },
          { id: 'p3', move_no: 131, my_move: 'C14', correct: 'D16', loss: 9, thought: '沒看到對方的扳。', type: '漏看對方的手段', in_self: false }] }
    ];
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function gen() {
      if (cache) return cache;
      const r = rng(20261026), out = [], K = 11; let aid = 1391200;
      for (let d = 199; d >= 0; d--) {
        const day = iso(d);
        const na = Math.max(0, 4 + Math.floor(r() * 3) - 1);
        for (let a = 0; a < na; a++) {
          aid++;
          const aLv = r() < .2 ? K - 1 : K;
          const x0 = r(); const mainI = x0 < .45 ? 0 : x0 < .65 ? 1 : x0 < .8 ? 2 : x0 < .9 ? 3 : 4;
          const size = r() < .5 ? 8 : 10, plus = r() < .3 ? '+' : '';
          for (let q = 1; q <= size; q++) {
            const ti = r() < .8 ? mainI : Math.floor(r() * 5);
            let lv = aLv; const x = r(); if (x < .08) lv = aLv - 1; else if (x < .16) lv = aLv + 1;
            const known = r() > .03;
            const pid = 100000 + ti * 17000 + lv * 1300 + Math.floor(r() * 260);
            const diff = (((pid * 2654435761) >>> 0) % 1000) / 1000 - .5;
            const p = Math.max(.3, Math.min(.98, .8 + [0, -.03, .06, -.05, -.02][ti] + (lv - K) * .06 + (200 - d) / 200 * .06 - diff * .3));
            const ok = r() < p;
            const sec = Math.max(2, Math.round(ok ? 3 + r() * r() * 22 + diff * 6 : (r() < .3 ? 2 + r() * 6 : 9 + r() * 30)));
            out.push({ task_id: aid, idx: q, problem_id: pid, ok, sec, task_day: day, difficulty: aLv + 'K' + plus, task_name: ['死活精練', '對殺特訓', '吃子練習', '官子入門', '手筋精選'][mainI] + ' 第' + (aid % 40 + 1) + '課',
              publicid: pid - 6417, levelname: known ? lv + 'K' : null, qtypename: RAW[ti], blackfirst: pid % 17 !== 0 });
          }
        }
      }
      return (cache = out);
    }
    const api = {
      demo: true,
      async visit() { return { today: 37, month: 412 }; },
      async current() { return signedIn ? Object.assign({}, me) : null; },
      async signIn() { await sleep(200); signedIn = true; return api.current(); },
      async myCode() { return 'K7QM2XRH9TPA'; },
      async signOut() { signedIn = false; },
      async rows(since) {
        await sleep(150);
        return gen().filter(r => r.task_day >= since).map(r => { const o = overrides[r.problem_id]; return Object.assign({}, r, { ov_levelname: o ? o.levelname : null, ov_qtypename: o ? o.qtypename : null }); });
      },
      async logs() {
        const rows = gen();
        return Array.from({ length: 7 }, (_, i) => {
          const key = iso(i), day = rows.filter(r => r.task_day === key);
          return { created_at: new Date(Date.now() - i * DAY - 3 * 3600e3).toISOString(), tasks_added: new Set(day.map(r => r.task_id)).size, attempts_added: day.length,
            problems_fetched: Math.round(day.length * .6), problems_failed: i === 3 ? 2 : 0, tasks_failed: 0, status: i === 3 ? 'partial' : 'done' };
        });
      },
      async saveProfile(patch) { Object.assign(me, JSON.parse(JSON.stringify(patch))); },
      async setOverride(problem_id, levelname, qtypename) { overrides[problem_id] = { levelname, qtypename }; },
      async clearOverride(problem_id) { delete overrides[problem_id]; },
      async games() { await sleep(120); return JSON.parse(JSON.stringify(demoGames)); },
      async saveGame(g) { await sleep(150); const x = JSON.parse(JSON.stringify(g)); if (!x.id) x.id = 'g' + Date.now(); const i = demoGames.findIndex(q => q.id === x.id); if (i >= 0) demoGames[i] = x; else demoGames.unshift(x); return JSON.parse(JSON.stringify(x)); },
      async deleteGame(gid) { const i = demoGames.findIndex(q => q.id === gid); if (i >= 0) demoGames.splice(i, 1); },
      async fox(body) {
        await sleep(250);
        if (body.action === 'user') return { result: 0, uid: '900001', username: String(body.name || '').replace(/[(（].*$/, '') || '関羽zero' };
        if (body.action === 'list') return { result: 0, chesslist: foxList };
        const it = foxList.find(c => c.chessid === body.chessid);
        return it ? { result: 0, chess: fakeSgf(Number(it.chessid.slice(-3)), it) } : { result: -1, resultstr: '找不到棋譜' };
      }
    };
    return api;
  }

  return (window.WQAPI = demo ? DemoAPI() : RealAPI());
};
