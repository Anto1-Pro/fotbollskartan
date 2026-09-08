/* score-api.js — poänglagring för Straffligan på Fotbollskarta.
 *
 * Det här är hela gränssnittet mot lagringen av poäng. Spelet (straffliga.js)
 * pratar ALDRIG direkt med localStorage eller något API — bara med FKScore
 * nedan. Byter man ut adaptern längst ner byter man backend utan att röra
 * spelet.
 *
 * Regler:
 *   - Vinst i ett straffavgörande  → 1 poäng till den egna föreningen.
 *   - Förlust                      → 1 poäng till motståndaren.
 *   - Avbrott innan avgörandet     → 1 poäng till motståndaren (walkover).
 *
 * ---------------------------------------------------------------------------
 * BYTA TILL EN RIKTIG BACKEND
 * ---------------------------------------------------------------------------
 * En delad topplista kräver att poängen sparas på en server. Skriv då en ny
 * adapter med exakt samma tre metoder som LocalAdapter längst ner:
 *
 *     addPoint(clubId, kind)   kind = "win" | "loss" | "walkover"
 *     totals()                 → { "<klubb-id>": { points, wins, losses, played } }
 *     flush()                  → skickar det som ligger i kö (valfritt)
 *
 * Exempel med Supabase (tabell "straffliga_poang" med kolumnerna club_id,
 * points, wins, losses, played och en RPC som räknar upp raden):
 *
 *     const SupabaseAdapter = {
 *       async addPoint(clubId, kind) {
 *         await fetch(URL + "/rest/v1/rpc/straffliga_add_point", {
 *           method: "POST",
 *           headers: { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY,
 *                      "Content-Type": "application/json" },
 *           body: JSON.stringify({ p_club_id: clubId, p_kind: kind }),
 *         });
 *       },
 *       async totals() {
 *         const r = await fetch(URL + "/rest/v1/straffliga_poang?select=*", {
 *           headers: { apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY },
 *         });
 *         const rows = await r.json();
 *         return Object.fromEntries(rows.map((x) => [x.club_id, x]));
 *       },
 *       async flush() {},
 *     };
 *
 * Sätt sedan ADAPTER = SupabaseAdapter. Använd Row Level Security så att bara
 * RPC:n får skriva — anon-nyckeln ligger synlig i frontend-koden.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  var STORE_KEY = "fk_straffliga_v1";
  var PENDING_KEY = "fk_straffliga_pending_v1";

  /* ---------- Lagring i besökarens webbläsare ---------- */

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      if (!obj || typeof obj !== "object") return {};
      return obj;
    } catch (e) {
      return {};
    }
  }

  function writeStore(obj) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  var LocalAdapter = {
    name: "local",
    /**
     * Ger klubben poängen för ett vunnet avgörande. kind är "win" (vann på
     * plan) eller "walkover" (motståndaren avbröt) — båda räknas som vinst.
     */
    addPoint: function (clubId, kind) {
      var store = readStore();
      var row = store[clubId] || { points: 0, wins: 0, losses: 0, played: 0 };
      row.points += 1;
      row.played += 1;
      row.wins += 1;
      store[clubId] = row;
      writeStore(store);
      return Promise.resolve();
    },
    /** Motståndaren får poängen, men förlusten ska bokföras på den som föll. */
    addLoss: function (clubId) {
      var store = readStore();
      var row = store[clubId] || { points: 0, wins: 0, losses: 0, played: 0 };
      row.losses += 1;
      row.played += 1;
      store[clubId] = row;
      writeStore(store);
      return Promise.resolve();
    },
    totals: function () {
      return Promise.resolve(readStore());
    },
    flush: function () {
      return Promise.resolve();
    },
  };

  var ADAPTER = LocalAdapter;

  /* ---------- Pågående match, för att kunna upptäcka avbrott ---------- */

  function readPending() {
    try {
      var raw = localStorage.getItem(PENDING_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearPending() {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch (e) {
      /* ignoreras */
    }
  }

  var FKScore = {
    /** Namnet på aktiv adapter — visas i informationsrutan på sidan. */
    backend: function () {
      return ADAPTER.name;
    },

    /**
     * Markerar att ett straffavgörande har startat. Stänger besökaren fliken
     * eller lämnar sidan innan det är klart räknas det som förlust nästa gång
     * sidan laddas.
     */
    matchStarted: function (ownId, opponentId) {
      try {
        localStorage.setItem(
          PENDING_KEY,
          JSON.stringify({ own: ownId, opp: opponentId, at: Date.now() })
        );
      } catch (e) {
        /* ignoreras */
      }
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
      var winner = won ? ownId : opponentId;
      var loser = won ? opponentId : ownId;
      return Promise.all([ADAPTER.addPoint(winner, "win"), ADAPTER.addLoss(loser)]).then(
        function () {
          return ADAPTER.flush();
        }
      );
    },

    /**
     * Bokför ett avbrott: motståndaren får poängen. Anropas både när besökaren
     * själv avbryter och när en oavslutad match hittas vid sidladdning.
     */
    reportAbandon: function (ownId, opponentId) {
      clearPending();
      return Promise.all([
        ADAPTER.addPoint(opponentId, "walkover"),
        ADAPTER.addLoss(ownId),
      ]).then(function () {
        return ADAPTER.flush();
      });
    },

    /**
     * Letar efter en match som aldrig spelades färdigt (t.ex. stängd flik) och
     * bokför den som förlust. Anropas en gång vid sidladdning.
     * @returns {Promise<object|null>} den avbrutna matchen, om någon fanns
     */
    settleAbandoned: function () {
      var p = readPending();
      if (!p || !p.own || !p.opp) {
        clearPending();
        return Promise.resolve(null);
      }
      return FKScore.reportAbandon(p.own, p.opp).then(function () {
        return p;
      });
    },

    /** Poängen för en enskild förening. */
    statsFor: function (clubId) {
      return ADAPTER.totals().then(function (all) {
        return all[clubId] || { points: 0, wins: 0, losses: 0, played: 0 };
      });
    },

    /**
     * Hela topplistan, som en lista sorterad på poäng.
     * @returns {Promise<Array<{clubId, points, wins, losses, played}>>}
     */
    leaderboard: function () {
      return ADAPTER.totals().then(function (all) {
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
      });
    },
  };

  window.FKScore = FKScore;
})();
