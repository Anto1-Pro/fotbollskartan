/* straffliga-topp.js — månadens topp 10 i Straffligan, på startsidan.
 *
 * Listan är gemensam för alla besökare och läses direkt ur Supabase (samma
 * tabell som spelets topplista). Publishable-nyckeln får bara läsa; poäng kan
 * bara skrivas via databasfunktionen straffligan_registrera — se
 * sql/straffligan.sql.
 *
 * Klubbnamnen ligger i straffliga-klubbar.json, en liten fil med de svenska
 * föreningarnas id, namn och distrikt (ca 130 kB, 48 kB komprimerat). Hela
 * data.json är 3 MB och alldeles för tung för startsidan. Filen genereras om
 * med tools/gen-straffliga-klubbar.py när klubbregistret ändras — saknas en
 * klubb i filen hoppas raden bara över.
 *
 * Allt hämtas först när rutan syns på skärmen, så startsidan blir inte
 * långsammare för den som aldrig skrollar dit.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://zltqnzabmrpqvxsxindf.supabase.co";
  var SUPABASE_KEY = "sb_publishable_nrmUk-rMVPZEWY3xQnQRqg_RhWUYMIx";
  var TABLE = "straffligan_poang_manad";
  var CLUBS_URL = "straffliga-klubbar.json";
  var TOP = 10;

  var MONTHS = [
    "januari", "februari", "mars", "april", "maj", "juni",
    "juli", "augusti", "september", "oktober", "november", "december",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  /** Första dagen i innevarande månad, svensk tid: "2026-09-01". */
  function currentMonth() {
    var y;
    var m;
    try {
      var bits = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Stockholm",
        year: "numeric",
        month: "2-digit",
      })
        .format(new Date())
        .split("-");
      y = bits[0];
      m = bits[1];
    } catch (e) {
      var d = new Date();
      y = String(d.getFullYear());
      m = String(d.getMonth() + 1);
    }
    if (m.length < 2) m = "0" + m;
    return y + "-" + m + "-01";
  }

  function monthName(iso) {
    var bits = String(iso).split("-");
    return (MONTHS[Number(bits[1]) - 1] || "") + " " + bits[0];
  }

  function nextReset(iso) {
    var bits = String(iso).split("-");
    var y = Number(bits[0]);
    var m = Number(bits[1]) + 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    return "1 " + MONTHS[m - 1] + " " + y;
  }

  function fetchTotals(month) {
    var url =
      SUPABASE_URL +
      "/rest/v1/" +
      TABLE +
      "?select=club_id,points,wins,losses,played&manad=eq." +
      month +
      "&order=points.desc,wins.desc&limit=40";
    return fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
    }).then(function (r) {
      if (!r.ok) throw new Error("supabase " + r.status);
      return r.json();
    });
  }

  function fetchClubs() {
    return fetch(CLUBS_URL).then(function (r) {
      if (!r.ok) throw new Error("klubbfil " + r.status);
      return r.json();
    });
  }

  function row(rank, name, district, points, played) {
    var li = document.createElement("li");
    li.className = "sl-row" + (rank <= 3 ? " is-podium" : "");

    var r = document.createElement("span");
    r.className = "sl-rank";
    r.textContent = String(rank);

    var mid = document.createElement("span");
    mid.className = "sl-club";
    var b = document.createElement("b");
    b.textContent = name;
    mid.appendChild(b);
    if (district) {
      var d = document.createElement("span");
      d.className = "sl-dist";
      d.textContent = district;
      mid.appendChild(d);
    }

    var p = document.createElement("span");
    p.className = "sl-points";
    p.textContent = points + " p";
    p.title = played + (played === 1 ? " match" : " matcher");

    li.appendChild(r);
    li.appendChild(mid);
    li.appendChild(p);
    return li;
  }

  function render(rows, clubs) {
    var list = $("slList");
    list.innerHTML = "";
    var shown = 0;
    for (var i = 0; i < rows.length && shown < TOP; i++) {
      var info = clubs[String(rows[i].club_id).slice(0, 12)];
      if (!info) continue; // okänt id (t.ex. testrad) hoppas över
      shown += 1;
      list.appendChild(
        row(shown, info[0], info[1], rows[i].points || 0, rows[i].played || 0)
      );
    }
    return shown;
  }

  function empty(month) {
    $("slList").innerHTML = "";
    $("slEmpty").hidden = false;
    $("slNote").textContent =
      "Listan börjar om den 1:a varje månad — nästa gång " + nextReset(month) + ".";
  }

  function load() {
    var box = $("slTop");
    if (!box) return;
    var month = currentMonth();
    $("slMonth").textContent = monthName(month);
    $("slLoading").hidden = false;

    fetchTotals(month)
      .then(function (rows) {
        if (!rows || !rows.length) {
          $("slLoading").hidden = true;
          empty(month);
          return null;
        }
        return fetchClubs().then(function (clubs) {
          $("slLoading").hidden = true;
          var n = render(rows, clubs);
          if (!n) {
            empty(month);
            return;
          }
          $("slEmpty").hidden = true;
          $("slNote").textContent =
            "Uppdateras direkt när någon spelar. Listan börjar om " +
            nextReset(month) +
            ".";
        });
      })
      .catch(function () {
        // Ingen anledning att skrämma besökaren — rutan tas bort tyst
        $("slLoading").hidden = true;
        box.hidden = true;
      });
  }

  function start() {
    var box = $("slTop");
    if (!box) return;
    box.hidden = false;
    if (!("IntersectionObserver" in window)) {
      load();
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            io.disconnect();
            load();
            return;
          }
        }
      },
      { rootMargin: "300px 0px" }
    );
    io.observe(box);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
