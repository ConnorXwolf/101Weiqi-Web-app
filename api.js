// 本手-棋力追蹤 data layer (personal). window.WQBoot() returns the Supabase API or an in-memory demo.
window.WQIsDemo = () => { const u = (window.WQ_CONFIG || {}).url; return !u || /YOUR-PROJECT/.test(u); };
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
      async clearOverride(problem_id) { const id = await uid(); chk(await sb.from('problem_overrides').delete().eq('student_id', id).eq('problem_id', problem_id)); }
    };
    return api;
  }

  function DemoAPI() {
    const rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const RAW = ['死活題', '對殺題', '吃子題', '官子題', '手筋題'];
    const me = { id: 'me', display_name: '林子晴', level: '11K', wq_username: 'zq_lin', last_synced_at: new Date(Date.now() - 3 * 3600e3).toISOString(),
      settings: { acc: 90, n: 100, fast: 8, slow: 20 }, type_map: {}, use_fallback: true, email: 'demo@demo' };
    let signedIn = false, cache = null; const overrides = {};
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
      async clearOverride(problem_id) { delete overrides[problem_id]; }
    };
    return api;
  }

  return (window.WQAPI = demo ? DemoAPI() : RealAPI());
};
