/* score-api.js — poänglagring för Straffligan på Fotbollskarta.
 *
 * Det här är hela gränssnittet mot lagringen av poäng. Spelet (straffligan.js)
 * pratar ALDRIG direkt med localStorage eller något API — bara med FKScore
 * längst ner. Byter man ut adaptern byter man backend utan att röra spelet.
 *
 * Regler:
 *   - Vinst i ett straffavgörande  → +2 poäng till den egna föreningen.
 *   - Förlust                      → -1 poäng, aldrig under 0.
 *   - Avbrott innan avgörandet     → räknas som förlust (motståndaren vinner).
 *
 * Två topplistor: "alla tider" och "denna månad". Månadslistan börjar om den
 * 1:a varje månad (svensk tid) så att den som hittar spelet sent kan hänga på.
 *
 * ---------------------------------------------------------------------------
 * LAGRING: SUPABASE (samma projekt som VM Tips)
 * ---------------------------------------------------------------------------
 * Tabellerna och funktionen skapas med sql/straffligan.sql. Nyckeln nedan är
 * en publishable-nyckel och är avsedd att ligga synlig i frontend-koden —
 * skyddet ligger i Row Level Security:
 *
 *   - straffligan_poang och straffligan_poang_manad får LÄSAS av alla, men
 *     ingen insert/update/delete-policy finns, så nyckeln kan inte ändra poäng.
 *   - Enda vägen att skriva är RPC:n straffligan_registrera(vinnare, förlorare)
 *     som alltid lägger till exakt en vinst och en förlust, i båda tabellerna.
 *
 * Går skrivningen inte igenom (besökaren är offline, servern svarar inte) läggs
 * matchen i en kö i localStorage och skickas nästa gång sidan används. Kön
 * räknas med i topplistan lokalt, så besökaren ser sin poäng direkt.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://zltqnzabmrpqvxsxindf.supabase.co";
  var SUPABASE_KEY = "sb_publishable_nrmUk-rMVPZEWY3xQnQRqg_RhWUYMIx";

  var TABLE_ALL = "straffligan_poang";
  var TABLE_MONTH = "straffligan_poang_manad";
  var RPC = "straffligan_registrera";

  var PENDING_KEY = "fk_straffliga_pending_v1"; // pågående match (avbrottsskydd)
  var QUEUE_KEY = "fk_straffliga_ko_v1"; // matcher som inte kunde skickas
  var CACHE_KEY = "fk_straffliga_cache_v1"; // senast hämtade topplistor
  var LOCAL_KEY = "fk_straffliga_v1"; // reservlagring, alla tider
  var LOCAL_MONTH_KEY = "fk_straffliga_manad_v1"; // reservlagring, denna månad

  var CACHE_MS = 15000; // hur länge en hämtad topplista får återanvändas
  var QUEUE_MAX = 40;
  var TIMEOUT_MS = 12000;

  var WIN_POINTS = 2; // vinst ger +2 poäng
  var LOSS_POINTS = -1; // förlust ger -1 poäng, men aldrig under 0

  /* ---------- små hjälpare ---------- */

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var obj = JSON.parse(raw);
      return obj === null || obj === undefined ? fallback : obj;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function removeKey(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignoreras */
    }
  }

  function emptyRow() {
    return { points: 0, wins: 0, losses: 0, played: 0 };
  }

  /** Första dagen i innevarande månad, svensk tid: "2026-09-01". */
  function currentMonth() {
    var y, m;
    try {
      var parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Stockholm",
        year: "numeric",
        month: "2-digit",
      }).format(new Date());
      // sv-SE ger "2026-09"
      var bits = String(parts).split("-");
      y = bits[0];
      m = bits[1];
    } catch (e) {
      var d = new Date();
      y = String(d.getFullYear());
      m = String(d.getMonth() + 1);
    }
    if (!y || !m) {
      var f = new Date();
      y = String(f.getFullYear());
      m = String(f.getMonth() + 1);
    }
    if (m.length < 2) m = "0" + m;
    return y + "-" + m + "-01";
  }

  function isMonth(period) {
    return period === "month" || period === "manad";
  }

  /* ---------- nätverk ---------- */

  function withTimeout(promiseFactory) {
    var ctrl = null;
    try {
      ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    } catch (e) {
      ctrl = null;
    }
    var timer = null;
    var p = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (ctrl) {
          try {
            ctrl.abort();
          } catch (e) {
            /* ignoreras */
          }
        }
        reject(new Error("timeout"));
      }, TIMEOUT_MS);
      promiseFactory(ctrl ? ctrl.signal : undefined).then(resolve, reject);
    });
    return p.then(
      function (v) {
        clearTimeout(timer);
        return v;
      },
      function (e) {
        clearTimeout(timer);
        throw e;
      }
    );
  }

  function headers(extra) {
    var h = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        h[k] = extra[k];
      });
    }
    return h;
  }

  function rowsToMap(rows) {
    var out = {};
    (rows || []).forEach(function (x) {
      if (!x || !x.club_id) return;
      out[x.club_id] = {
        points: x.points || 0,
        wins: x.wins || 0,
        losses: x.losses || 0,
        played: x.played || 0,
      };
    });
    return out;
  }

  var SupabaseAdapter = {
    name: "supabase",

    /** Registrerar ett avgjort avgörande. Allt annat än 2xx räknas som fel. */
    record: function (winnerId, loserId) {
      return withTimeout(function (signal) {
        return fetch(SUPABASE_URL + "/rest/v1/rpc/" + RPC, {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ p_vinnare: winnerId, p_forlorare: loserId }),
          signal: signal,
        });
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(
            function (t) {
              throw new Error("supabase " + r.status + ": " + (t || "").slice(0, 200));
            },
            function () {
              throw new Error("supabase " + r.status);
            }
          );
        }
        return true;
      });
    },

    /** Poängtabellen som { "<klubb-id>": { points, wins, losses, played } }. */
    totals: function (period) {
      var url = isMonth(period)
        ? SUPABASE_URL +
          "/rest/v1/" +
          TABLE_MONTH +
          "?select=club_id,points,wins,losses,played&manad=eq." +
          currentMonth() +
          "&order=points.desc,wins.desc&limit=5000"
        : SUPABASE_URL +
          "/rest/v1/" +
          TABLE_ALL +
          "?select=club_id,points,wins,losses,played&order=points.desc,wins.desc&limit=5000";
      return withTimeout(function (signal) {
        return fetch(url, { headers: headers(), signal: signal });
      })
        .then(function (r) {
          if (!r.ok) throw new Error("supabase " + r.status);
          return r.json();
        })
        .then(rowsToMap);
    },
  };

  /* Reserv om nycklarna tas bort: allt sparas då bara i webbläsaren. */
  var LocalAdapter = {
    name: "local",
    record: function (winnerId, loserId) {
      var bump = function (key, monthly) {
        var store;
        if (monthly) {
          var box = readJson(key, null);
          store = box && box.manad === currentMonth() && box.data ? box.data : {};
        } else {
          store = readJson(key, {});
        }
        var w = store[winnerId] || emptyRow();
        w.points += WIN_POINTS;
        w.wins += 1;
        w.played += 1;
        store[winnerId] = w;
        var l = store[loserId] || emptyRow();
        l.points = Math.max(0, (l.points || 0) + LOSS_POINTS);
        l.losses += 1;
        l.played += 1;
        store[loserId] = l;
        writeJson(key, monthly ? { manad: currentMonth(), data: store } : store);
      };
      bump(LOCAL_KEY, false);
      bump(LOCAL_MONTH_KEY, true);
      return Promise.resolve(true);
    },
    totals: function (period) {
      if (isMonth(period)) {
        var box = readJson(LOCAL_MONTH_KEY, null);
        return Promise.resolve(box && box.manad === currentMonth() && box.data ? box.data : {});
      }
      return Promise.resolve(readJson(LOCAL_KEY, {}));
    },
  };

  var ADAPTER = SUPABASE_URL && SUPABASE_KEY ? SupabaseAdapter : LocalAdapter;

  /* ---------- kö för matcher som inte kunde skickas ---------- */

  function readQueue() {
    var q = readJson(QUEUE_KEY, []);
    return Object.prototype.toString.call(q) === "[object Array]" ? q : [];
  }

  function enqueue(winnerId, loserId) {
    var q = readQueue();
    q.push({ w: winnerId, l: loserId, at: Date.now() });
    if (q.length > QUEUE_MAX) q = q.slice(q.length - QUEUE_MAX);
    writeJson(QUEUE_KEY, q);
  }

  var flushing = null;

  /** Skickar kön i tur och ordning. Stannar vid första felet, behåller resten. */
  function flushQueue() {
    if (flushing) return flushing;
    if (!readQueue().length) return Promise.resolve(0);

    var sent = 0;
    var step = function () {
      var left = readQueue();
      if (!left.length) return Promise.resolve(sent);
      var item = left[0];
      if (!item || !item.w || !item.l || item.w === item.l) {
        left.shift();
        writeJson(QUEUE_KEY, left);
        return step();
      }
      return ADAPTER.record(item.w, item.l).then(
        function () {
          var now = readQueue();
          now.shift();
          writeJson(QUEUE_KEY, now);
          sent += 1;
          return step();
        },
        function () {
          return sent; // servern svarar inte — försök igen senare
        }
      );
    };

    flushing = step().then(
      function (n) {
        flushing = null;
        if (n > 0) cache = {};
        return n;
      },
      function () {
        flushing = null;
        return sent;
      }
    );
    return flushing;
  }

  /** Poängen som ligger i kö och alltså inte finns på servern än. */
  function queueDeltas() {
    var out = {};
    readQueue().forEach(function (item) {
      if (!item || !item.w || !item.l) return;
      var w = out[item.w] || (out[item.w] = emptyRow());
      w.points += WIN_POINTS;
      w.wins += 1;
      w.played += 1;
      var l = out[item.l] || (out[item.l] = emptyRow());
      l.points += LOSS_POINTS;
      l.losses += 1;
      l.played += 1;
    });
    return out;
  }

  function mergeDeltas(base, deltas) {
    var out = {};
    Object.keys(base).forEach(function (id) {
      var r = base[id] || {};
      out[id] = {
        points: r.points || 0,
        wins: r.wins || 0,
        losses: r.losses || 0,
        played: r.played || 0,
      };
    });
    Object.keys(deltas).forEach(function (id) {
      var d = deltas[id];
      var r = out[id] || (out[id] = emptyRow());
      r.points = Math.max(0, r.points + d.points); // aldrig under 0
      r.wins += d.wins;
      r.losses += d.losses;
      r.played += d.played;
    });
    return out;
  }

  /* ---------- hämtning med kort cache och reserv ---------- */

  var cache = {}; // { all: {at,data}, month: {at,data,manad} }
  var offline = false;

  function cacheSlot(period) {
    return isMonth(period) ? "month" : "all";
  }

  function readSavedCache(slot) {
    var box = readJson(CACHE_KEY, null);
    if (!box || !box[slot]) return null;
    var entry = box[slot];
    if (slot === "month" && entry.manad !== currentMonth()) return null;
    return entry.data || null;
  }

  function saveCache(slot, data) {
    var box = readJson(CACHE_KEY, {}) || {};
    box[slot] = { at: Date.now(), data: data };
    if (slot === "month") box[slot].manad = currentMonth();
    writeJson(CACHE_KEY, box);
  }

  function fetchTotals(period, force) {
    var slot = cacheSlot(period);
    var hit = cache[slot];
    if (hit && slot === "month" && hit.manad !== currentMonth()) hit = null;
    if (!force && hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.data);

    return ADAPTER.totals(period).then(
      function (data) {
        cache[slot] = { at: Date.now(), data: data, manad: currentMonth() };
        offline = false;
        if (ADAPTER === SupabaseAdapter) saveCache(slot, data);
        return data;
      },
      function () {
        offline = true;
        var saved = readSavedCache(slot);
        var data = saved || (slot === "month" ? {} : readJson(LOCAL_KEY, {}));
        cache[slot] = { at: Date.now(), data: data, manad: currentMonth() };
        return data;
      }
    );
  }

  function totals(period, force) {
    return flushQueue()
      .catch(function () {})
      .then(function () {
        return fetchTotals(period, force);
      })
      .then(function (data) {
        return mergeDeltas(data, queueDeltas());
      });
  }

  /** Skriver ett resultat. Misslyckas det hamnar det i kön. */
  function record(winnerId, loserId) {
    if (!winnerId || !loserId || winnerId === loserId) return Promise.resolve(false);
    return flushQueue()
      .catch(function () {})
      .then(function () {
        return ADAPTER.record(winnerId, loserId).then(
          function () {
            offline = false;
            cache = {};
            return true;
          },
          function () {
            offline = true;
            enqueue(winnerId, loserId);
            cache = {};
            return false;
          }
        );
      });
  }

  function clearPending() {
    removeKey(PENDING_KEY);
  }

  function listFrom(all) {
    var rows = Object.keys(all).map(function (id) {
      var r = all[id] || {};
      return {
        clubId: id,
        points: r.points || 0,
        wins: r.wins || 0,
        losses: r.losses || 0,
        played: r.played || 0,
      };
    });
    rows.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.played - b.played;
    });
    return rows;
  }

  var FKScore = {
    /** Namnet på aktiv lagring — visas i informationsrutan på sidan. */
    backend: function () {
      return ADAPTER.name;
    },

    /** true om senaste anropet mot servern misslyckades. */
    isOffline: function () {
      return offline;
    },

    /** Antal matcher som väntar på att skickas. */
    pendingCount: function () {
      return readQueue().length;
    },

    /** Innevarande månad som "2026-09-01" (svensk tid). */
    currentMonth: currentMonth,

    /**
     * Markerar att ett straffavgörande har startat. Stänger besökaren fliken
     * eller lämnar sidan innan det är klart räknas det som förlust nästa gång
     * sidan laddas.
     */
    matchStarted: function (ownId, opponentId) {
      writeJson(PENDING_KEY, { own: ownId, opp: opponentId, at: Date.now() });
    },

    /** Straffavgörandet spelades färdigt — inget avbrott att bokföra. */
    matchEnded: function () {
      clearPending();
    },

    /**
     * Rapporterar ett avgjort straffavgörande.
     * @param {string} ownId       den egna föreningens id
     * @param {string} opponentId  motståndarens id
     * @param {boolean} won        true om den egna föreningen vann
     */
    reportResult: function (ownId, opponentId, won) {
      clearPending();
      return record(won ? ownId : opponentId, won ? opponentId : ownId);
    },

    /**
     * Bokför ett avbrott: motståndaren får poängen. Anropas både när besökaren
     * själv avbryter och när en oavslutad match hittas vid sidladdning.
     */
    reportAbandon: function (ownId, opponentId) {
      clearPending();
      return record(opponentId, ownId);
    },

    /**
     * Letar efter en match som aldrig spelades färdigt (t.ex. stängd flik) och
     * bokför den som förlust. Anropas en gång vid sidladdning.
     * @returns {Promise<object|null>} den avbrutna matchen, om någon fanns
     */
    settleAbandoned: function () {
      var p = readJson(PENDING_KEY, null);
      if (!p || !p.own || !p.opp) {
        clearPending();
        flushQueue().catch(function () {});
        return Promise.resolve(null);
      }
      return FKScore.reportAbandon(p.own, p.opp).then(function () {
        return p;
      });
    },

    /**
     * Poängen för en enskild förening. Hämtas alltid färskt.
     * @param {string} clubId
     * @param {string} [period] "all" (standard) eller "month"
     */
    statsFor: function (clubId, period) {
      return totals(period || "all", true).then(function (all) {
        return all[clubId] || emptyRow();
      });
    },

    /**
     * Hela topplistan, sorterad på poäng.
     * @param {string} [period] "all" (standard) eller "month"
     * @param {boolean} [force] hoppa över den korta cachen
     * @returns {Promise<Array<{clubId, points, wins, losses, played}>>}
     */
    leaderboard: function (period, force) {
      return totals(period || "all", !!force).then(listFrom);
    },

    /** Försöker skicka det som ligger i kö. */
    flush: function () {
      return flushQueue().catch(function () {
        return 0;
      });
    },
  };

  window.FKScore = FKScore;

  /* Nytt försök när besökaren får nätet tillbaka. */
  try {
    window.addEventListener("online", function () {
      flushQueue().catch(function () {});
    });
  } catch (e) {
    /* ignoreras */
  }
})();
