// ==UserScript==
// @name         Postino
// @namespace    postino-rym
// @version      1.0a
// @description  Porta i dati di una release da Discogs o Bandcamp nel modulo "Add Release" di Rateyourmusic, seguendo le regole di Rym. Non invia nulla: anteprima e invio restano a te.
// @match        https://www.discogs.com/*
// @match        https://*.bandcamp.com/*
// @match        https://rateyourmusic.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      api.discogs.com
// @run-at       document-idle
// ==/UserScript==

// Postino 1.0a — Discogs / Bandcamp → Rateyourmusic
// Uso: su una release Discogs o un album Bandcamp premi "→ Rym" (in basso a destra);
// poi, sulla pagina "Add release" di Rym, premi "Compila modulo" nel pannello e controlla le voci "Da fare".

(function () {
  'use strict';
  const LANG = 'it';
  const say = (it, en) => (LANG === 'it' ? it : en);

  const KEY = 'discogs_rym_data';
  const host = location.hostname;

  // ---------- utilità comuni ----------
  const clean = (s) => (s || '').replace(/\s\(\d+\)$/, '').trim(); // "Artista (2)" -> "Artista"
  const $ = (sel) => document.querySelector(sel);
  const pad2 = (n) => String(n).padStart(2, '0');
  const isVarious = (name) => /^various( artists)?$/i.test(clean(name));

  function css(el, styles) { Object.assign(el.style, styles); return el; }

  function btn(text, onClick, bg = '#2a6fdb') {
    const b = document.createElement('button');
    b.textContent = text;
    b.type = 'button';
    css(b, { background: bg, color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 10px', margin: '3px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' });
    b.addEventListener('click', onClick);
    return b;
  }

  function floatingButton(onClick) {
    const b = btn('→ Rym', onClick, '#c0392b');
    css(b, { position: 'fixed', bottom: '20px', right: '20px', zIndex: 99999, padding: '10px 16px', fontSize: '15px', boxShadow: '0 2px 6px rgba(0,0,0,.4)' });
    document.body.appendChild(b);
    return b;
  }

  // salva i dati e apre Rym sulla ricerca giusta
  // Avviso temporaneo in basso a destra (verde = ok, rosso = errore)
  function toast(msg, ok = true) {
    let t = document.getElementById('drym_toast');
    if (!t) { t = document.createElement('div'); t.id = 'drym_toast'; document.body.appendChild(t); }
    css(t, { position: 'fixed', bottom: '75px', right: '20px', zIndex: 100000, maxWidth: '380px', padding: '10px 14px',
      background: ok ? '#27ae60' : '#c0392b', color: '#fff', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold',
      boxShadow: '0 2px 8px rgba(0,0,0,.4)', transition: 'opacity .4s', opacity: '1' });
    t.textContent = msg;
    clearTimeout(t.hideTimer);
    t.hideTimer = setTimeout(() => { t.style.opacity = '0'; }, ok ? 4000 : 8000);
  }

  // Salva i dati per Rym: il pannello sulla pagina "Add release" già aperta si aggiorna da solo
  function sendToRym(data) {
    data.savedAt = Date.now(); // rende ogni invio diverso dal precedente (serve all'aggiornamento live su Rym)
    GM_setValue(KEY, JSON.stringify(data));
    toast('✔ Dati salvati – ' + data.artist + ' – ' + data.title);
  }

  // secondi -> "m:ss" (o "h:mm:ss" oltre l'ora); 0 o vuoto -> ''
  function secToTime(sec) {
    const s = Math.round(Number(sec) || 0);
    if (s <= 0) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r);
  }

  // durata ISO 8601 ("P00H03M45S", "PT3M45S") -> secondi
  function isoToSec(iso) {
    const m = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(iso || '');
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }

  // =====================================================================
  //  LATO DISCOGS
  // =====================================================================
  if (host.endsWith('discogs.com')) {
    const b = floatingButton(onDiscogsClick);
    b.style.display = 'none';

    // Discogs è una SPA: mostra il pulsante solo sulle pagine release
    setInterval(() => {
      b.style.display = /\/(release|master)\/\d+/.test(location.pathname) ? 'block' : 'none';
    }, 800);

    function getJSON(url, ok, ko) {
      GM_xmlhttpRequest({
        method: 'GET', url, headers: { Accept: 'application/json' },
        onload: (r) => {
          if (r.status !== 200) return ko(r.status);
          let j; try { j = JSON.parse(r.responseText); } catch (e) { return ko('JSON'); }
          ok(j);
        },
        onerror: () => ko(say('rete', 'network'))
      });
    }

    // ogni clic ha un numero: le risposte di un clic precedente vengono ignorate
    let reqId = 0;
    function onDiscogsClick() {
      const my = ++reqId;
      const live = () => my === reqId;
      const m = location.pathname.match(/\/(release|master)\/(\d+)/);
      if (!m) return toast(say('Apri una pagina release (o master) di Discogs.', 'Open a Discogs release (or master) page.'), false);
      b.textContent = say('Carico…', 'Loading…');
      const fail = (why) => { if (!live()) return; b.textContent = '→ Rym'; toast(say('Errore API Discogs: ', 'Discogs API error: ') + why, false); };
      // pagina master: si importa la sua release principale
      if (m[1] === 'master') {
        getJSON('https://api.discogs.com/masters/' + m[2], (mj) => {
          if (!live()) return;
          if (!mj.main_release) return fail('main_release');
          loadRelease(mj.main_release, mj);
        }, fail);
        return;
      }
      loadRelease(m[2], null);

      function loadRelease(id, master) {
        getJSON('https://api.discogs.com/releases/' + id, (d) => {
          if (!live()) return;
          b.textContent = '→ Rym';
          const data = normalizeDiscogs(d);
          if (master) {
            data.masterYear = master.year || null; data.mainRelease = master.main_release || null; data.fromMaster = true;
            return sendToRym(data);
          }
          if (!d.master_id) return sendToRym(data);
          // master: anno della prima uscita, per riconoscere le ristampe non dichiarate
          getJSON('https://api.discogs.com/masters/' + d.master_id, (mj) => {
            if (!live()) return;
            data.masterYear = mj.year || null; data.mainRelease = mj.main_release || null;
            sendToRym(data);
          }, () => { if (live()) sendToRym(data); });
        }, fail);
      }
    }

    function normalizeDiscogs(d) {
      // Artista
      let artist = '';
      (d.artists || []).forEach((a) => {
        artist += clean(a.anv || a.name);
        if (a.join) artist += a.join === ',' ? ', ' : ' ' + a.join + ' ';
      });
      artist = artist.trim();

      // Data
      const [y, mo, da] = (d.released || String(d.year || '')).split('-');

      // Formato: salta i contenitori ("Box Set", "All Media") e prende il primo supporto reale
      const media = (d.formats || []).filter((x) => !['Box Set', 'All Media'].includes(x.name));
      const f = media[0] || (d.formats || [])[0] || {};

      // Tracce. Le opere in più movimenti ("index track" di Discogs) diventano, come su Rym,
      // una riga d'intestazione senza numero (il titolo dell'opera) seguita dai movimenti.
      // Anche le intestazioni di sezione ("Registrazioni Live", il nome di un'opera…) diventano righe senza numero;
      // si saltano solo quelle generiche dei lati ("Side A") e dei supporti senza titolo ("CD 1", "DVD").
      const classical = (d.genres || []).includes('Classical');
      const SIDE_HEADING = /^(side|face|lato)\s*[a-z0-9]+\.?$|^[a-z]\d*$|^\d+$/i;
      const PLAIN_MEDIA_HEADING = /^(cd|dvd|blu-?ray|bd|sacd|disc|disk|lp|vinyl|cassette|tape|record|vhs)\s*[-.:#]?\s*\d*\.?$/i;
      const MEDIA_HEADING = /^(cd|dvd|blu-?ray|bd|sacd|disc|disk|vhs)\b/i; // es. 'DVD "Concerto Live"'
      const pipe = (s) => (s || '').replace(/\|/g, '/');
      // artista della traccia (compilation V/A): "Adham Zahran", "A & B", "A feat. B"
      const artistOf = (list) => {
        let a = '';
        (list || []).forEach((x) => { a += clean(x.anv || x.name); if (x.join) a += x.join === ',' ? ', ' : ' ' + x.join + ' '; });
        return pipe(a.trim());
      };
      const namesOf = (list) => (list || []).map((x) => clean(x.name)).filter((x) => x && !isVarious(x));
      let n = 0;
      const tracks = [];
      // supporto indicato dalle intestazioni ("CD 1", "DVD"): passa alle tracce che seguono
      let curMedia = null;
      const OPTICAL_HEADING = /^(cd|dvd|blu-?ray|bd|sacd|vhs)\s*[-.:#]?\s*(\d*)\.?(?:\s|$)/i;
      const hint = (row) => { if (curMedia) { row.mediaHint = curMedia.label; if (curMedia.disc) row.discHint = curMedia.disc; } return row; };
      (d.tracklist || []).forEach((t) => {
        if (t.type_ === 'heading') {
          const h = (t.title || '').trim();
          const om = h.match(OPTICAL_HEADING);
          // CD/DVD: il supporto resta alle tracce; gli altri supporti (LP, cassetta, "Disc") azzerano l'informazione
          if (om) curMedia = { label: om[1], disc: om[2] || '' };
          else if (PLAIN_MEDIA_HEADING.test(h) || MEDIA_HEADING.test(h)) curMedia = null;
          if (!h || SIDE_HEADING.test(h) || PLAIN_MEDIA_HEADING.test(h)) return;
          const row = { pos: '', title: pipe(h), dur: '', header: true };
          if (MEDIA_HEADING.test(h)) row.mediaHeading = true; // sostituita dalla riga "CD"/"DVD" se ci sono più supporti
          tracks.push(row);
          return;
        }
        if (t.type_ === 'index' && Array.isArray(t.sub_tracks) && t.sub_tracks.length) {
          tracks.push({ pos: '', title: pipe(t.title), dur: '', header: true });
          // numero dell'opera: dal campo dell'indice, dalle sottotracce "3.1" / "3.a", altrimenti il prossimo numero libero
          const dotted = (p) => (p || '').trim().match(/^(.+?)[.\-](\d+|[a-z])$/i);
          const firstDot = t.sub_tracks.map((x) => dotted(x.position)).find(Boolean);
          let work = (t.position || '').trim() || (firstDot ? firstDot[1] : '');
          const needRun = !work && t.sub_tracks.some((x) => !(x.position || '').trim() || /^[a-z]$/i.test((x.position || '').trim()));
          if (needRun) { n++; work = String(n); }
          t.sub_tracks.forEach((s, k) => {
            if (!needRun) n++;
            const sp = (s.position || '').trim();
            const letter = String.fromCharCode(97 + k);
            // "3.1", "3.a", "a" o vuoto -> "3a", "3b"…; le posizioni già distinte ("4", "B2", "3a") restano
            const pos = (!sp || dotted(sp) || /^[a-z]$/i.test(sp)) && work ? work + letter : (sp || String(n));
            tracks.push(hint({ pos, title: pipe(s.title), dur: s.duration || '', artist: artistOf(s.artists || t.artists), artists: namesOf(s.artists || t.artists) }));
          });
          return;
        }
        if (t.type_ === 'track' || t.type_ === 'index') {
          n++;
          tracks.push(hint({ pos: (t.position || String(n)).trim(), title: pipe(t.title), dur: t.duration || '', artist: artistOf(t.artists), artists: namesOf(t.artists) }));
        }
      });

      return {
        source: 'Discogs',
        id: d.id,
        url: 'https://www.discogs.com/release/' + d.id,
        artist,
        artistSearch: clean((d.artists || [])[0]?.name || artist),
        title: d.title || '',
        year: y && y !== '0000' ? y : '',
        month: mo && mo !== '00' ? mo : '',
        day: da && da !== '00' ? da : '',
        labels: (d.labels || []).map((l) => ({ name: clean(l.name), catno: /^none$/i.test(l.catno || '') ? '' : (l.catno || ''), noCat: /^none$/i.test(l.catno || '') })),
        country: d.country || '',
        formatName: f.name || '',
        boxSet: (d.formats || []).some((x) => x.name === 'Box Set'),
        various: (d.artists || []).some((a) => isVarious(a.name)),
        classical,
        descriptions: (d.formats || []).flatMap((x) => x.descriptions || []),
        // descrizioni del supporto principale (più quelle del contenitore Box Set/All Media): decidono tipo e misura
        mainDescriptions: (d.formats || []).filter((x) => x === f || ['Box Set', 'All Media'].includes(x.name)).flatMap((x) => x.descriptions || []),
        formatTexts: (d.formats || []).map((x) => x.text || '').filter(Boolean),
        // testo libero dei soli supporti in vinile/shellac (il colore di un CD allegato non conta)
        vinylTexts: (d.formats || []).filter((x) => /vinyl|lathe|flexi|shellac/i.test(x.name || '')).map((x) => x.text || '').filter(Boolean),
        tracks,
        credits: (d.extraartists || []).map((c) => clean(c.anv || c.name) + ' – ' + c.role + (c.tracks ? ' (' + c.tracks + ')' : '')),
        genres: d.genres || [],
        styles: d.styles || [],
        notes: d.notes || '',
        bonusHeading: (d.tracklist || []).some((t) => t.type_ === 'heading' && /bonus/i.test(t.title || '')),
        compiledBy: (d.extraartists || []).some((c) => /compiled by/i.test(c.role || '') && !c.tracks),
        // "feat." da aggiungere come crediti featured su Rym (per traccia o per l'intera release)
        featured: [...new Set([
          ...(d.tracklist || []).flatMap((t) => [t].concat(t.sub_tracks || []))
            .flatMap((t) => (t.extraartists || []).filter((c) => /featuring/i.test(c.role || '')).map((c) => clean(c.anv || c.name) + (t.position ? ' (' + t.position + ')' : ''))),
          ...(d.extraartists || []).filter((c) => /featuring/i.test(c.role || '')).map((c) => clean(c.anv || c.name) + (c.tracks ? ' (' + c.tracks + ')' : ''))
        ])],
        // interpreti (per la classica: il file under su Rym va a loro)
        performers: [...new Set((d.extraartists || [])
          .filter((c) => /conductor|orchestra|ensemble|choir|chorus|soloist|quartet|trio|violin|viola|cello|piano|soprano|tenor|baritone|mezzo|contralto|harpsichord|organ|guitar|flute|oboe|clarinet|bassoon|horn|trumpet|harp/i.test(c.role || ''))
          .map((c) => clean(c.anv || c.name) + ' (' + c.role + ')'))],
        // artisti principali con i loro legami ("&", "Feat.", "/")
        artistsList: (d.artists || []).map((a) => ({ name: clean(a.name), anv: clean(a.anv || ''), join: (a.join || '').trim(), various: isVarious(a.name) })),
        // crediti strutturati: release (con campo tracce) e per traccia
        creditList: (d.extraartists || []).map((c) => ({ name: clean(c.anv || c.name), role: c.role || '', tracks: c.tracks || '' }))
          .concat((d.tracklist || []).flatMap((t) => [t].concat(t.sub_tracks || []))
            .flatMap((t) => (t.extraartists || []).map((c) => ({ name: clean(c.anv || c.name), role: c.role || '', tracks: (t.position || '').trim() })))),
        rightsSocieties: (d.identifiers || []).filter((x) => /rights society/i.test(x.type || '')).map((x) => x.value || ''),
        depositoLegal: (d.identifiers || []).some((x) => /dep[oó]sito legal/i.test(x.type || '')),
        companies: (d.companies || []).map((c) => ({ name: clean(c.name), role: c.entity_type_name || '' })),
        series: (d.series || []).map((x) => clean(x.name) + (x.catno && !/^none$/i.test(x.catno) ? ' ' + x.catno : '')),
        formatsAll: (d.formats || []).map((x) => ({ name: x.name || '', qty: x.qty || '1', descriptions: x.descriptions || [], text: x.text || '' }))
      };
    }
    return;
  }

  // =====================================================================
  //  LATO BANDCAMP (nessuna API: legge i dati già presenti nella pagina)
  // =====================================================================
  if (host.endsWith('bandcamp.com')) {
    if (!/^\/(album|track)\//.test(location.pathname)) return;
    const b = floatingButton(() => {
      try {
        sendToRym(normalizeBandcamp());
      } catch (e) {
        toast('Non riesco a leggere i dati di questa pagina Bandcamp. ' + e.message, false);
      }
    });
    b.title = 'Invia questa release al modulo Rym';

    function readJsonLd() {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          const t = [].concat(j['@type'] || []).join(' ');
          if (/MusicAlbum|MusicRecording/.test(t)) return j;
        } catch (e) { /* blocco non valido: ignora */ }
      }
      return null;
    }

    function readTralbum() {
      const el = document.querySelector('[data-tralbum]');
      if (!el) return null;
      try { return JSON.parse(el.getAttribute('data-tralbum')); } catch (e) { return null; }
    }

    function normalizeBandcamp() {
      const ld = readJsonLd();
      const tr = readTralbum();
      if (!ld && !tr) throw new Error(say('Dati album non trovati.', 'Album data not found.'));
      const isTrack = location.pathname.startsWith('/track/');

      const title = (tr?.current?.title || ld?.name || '').trim();
      const artist = (tr?.artist || ld?.byArtist?.name || '').trim();
      if (!title || !artist) throw new Error(say('Titolo o artista mancanti.', 'Missing title or artist.'));

      // Edizioni in vendita: digitale e fisiche (vinile, CD, cassetta) dallo schema.org
      const releases = [].concat(ld?.albumRelease || ld?.inAlbum?.albumRelease || []).filter((x) => x && typeof x === 'object');
      // Etichetta: prima il campo "recordLabel", poi l'account che pubblica se diverso dall'artista
      const labelOf = (x) => (x && x.recordLabel && x.recordLabel.name) || '';
      const digitalRel = releases.find((x) => /DigitalFormat$/.test(String(x.musicReleaseFormat || '')));
      const recordLabel = (labelOf(digitalRel) || releases.map(labelOf).find(Boolean) || '').trim();
      const publisher = (ld?.publisher?.name || '').trim();
      const labelName = recordLabel || (publisher && publisher.toLowerCase() !== artist.toLowerCase() ? publisher : '');
      const labels = labelName && labelName.toLowerCase() !== artist.toLowerCase() ? [{ name: labelName, catno: '', noCat: false }] : [];

      // Data, es. "15 Mar 2019 00:00:00 GMT"
      const ymd = (v) => { const x = new Date(v || ''); return isNaN(x) ? null : [String(x.getUTCFullYear()), pad2(x.getUTCMonth() + 1), pad2(x.getUTCDate())]; };
      let year = '', month = '', day = '', oldDate = '';
      const rel = ymd(tr?.current?.release_date || tr?.album_release_date || ld?.datePublished);
      // data di pubblicazione: quando l'album è comparso su Bandcamp (la data di uscita la sceglie l'artista)
      const pub = ymd(tr?.current?.publish_date);
      if (rel) {
        [year, month, day] = rel;
        // Bandcamp esiste dal 2008: una data precedente è quella dell'uscita originale, non dell'issue digitale.
        // Rym: se non c'è una fonte affidabile per la data digitale, va lasciata vuota.
        if (+year < 2008) { oldDate = [day, month, year].join('/'); year = month = day = ''; }
      }
      const pubDate = pub ? pub.join('-') : '';
      const relDate = rel ? rel.join('-') : '';
      // pubblicata molto dopo la data di uscita: probabile ristampa digitale di un'uscita più vecchia
      const lateUpload = !!(rel && pub && (Date.parse(pubDate) - Date.parse(relDate)) > 45 * 864e5);

      // Scaricabile? (Rym: issue Bandcamp = versione scaricabile, formato lossless se disponibile)
      const tinfo = (tr && Array.isArray(tr.trackinfo)) ? tr.trackinfo : [];
      let downloadable = null;
      if (tr && tr.freeDownloadPage) downloadable = true;
      else if (tinfo.some((t) => t.is_downloadable === true)) downloadable = true;
      else if (tinfo.length && tinfo.every((t) => t.is_downloadable === false)) downloadable = false;

      // Tracce: prima dal blocco data-tralbum, altrimenti dallo schema.org
      let tracks = [];
      if (tr && Array.isArray(tr.trackinfo) && tr.trackinfo.length) {
        tracks = (isTrack ? tr.trackinfo.slice(0, 1) : tr.trackinfo).map((t, i) => ({ pos: isTrack ? '1' : String(t.track_num || i + 1), title: (t.title || '').replace(/\|/g, '/'), dur: secToTime(t.duration), artist: (t.artist || '').trim() }));
      } else if (ld?.track?.itemListElement) {
        tracks = ld.track.itemListElement.map((e, i) => ({ pos: String(e.position || i + 1), title: (e.item?.name || '').replace(/\|/g, '/'), dur: secToTime(isoToSec(e.item?.duration)) }));
      } else if (isTrack && ld) {
        tracks = [{ pos: '1', title: (ld.name || '').replace(/\|/g, '/'), dur: secToTime(isoToSec(ld.duration)) }];
      }

      // pagina traccia che fa parte di un album: non è un singolo a sé
      const partOfAlbum = isTrack && !!(tr?.album_url || (ld?.inAlbum && (ld.inAlbum.numTracks || 0) > 1));

      // copertina originale (suffisso _0 = file caricato dall'artista, non l'anteprima quadrata)
      const artId = tr?.art_id || tr?.current?.art_id || 0;
      const artUrl = artId ? 'https://f4.bcbits.com/img/a' + String(artId).padStart(10, '0') + '_0.jpg' : '';

      // codice embed per i media link di Rym (solo album: Rym non supporta le tracce Bandcamp)
      let embed = '';
      try {
        const em = JSON.parse(document.querySelector('[data-embed]')?.getAttribute('data-embed') || 'null');
        if (em && em.tralbum_param && em.tralbum_param.name === 'album') {
          const href = location.origin + location.pathname;
          embed = '<iframe style="border: 0; width: 350px; height: 470px;" src="https://bandcamp.com/EmbeddedPlayer/album=' + em.tralbum_param.value +
            '/size=large/bgcol=ffffff/linkcol=0687f5/tracklist=false/transparent=true/" seamless><a href="' + href + '">' +
            (em.album_title || title).replace(/[<>"]/g, '') + ' by ' + (em.artist || artist).replace(/[<>"]/g, '') + '</a></iframe>';
        }
      } catch (e) { /* - */ }

      // edizioni fisiche: da schema.org e dal blocco "packages" (campi letti con tolleranza)
      const FORMAT_LD = { VinylFormat: 'Vinyl', CDFormat: 'CD', CassetteFormat: 'Cassette', DVDFormat: 'DVD' };
      const pk = Array.isArray(tr?.packages) ? tr.packages : [];
      const physical = releases.filter((x) => x.musicReleaseFormat && x.musicReleaseFormat !== 'DigitalFormat').map((x, i) => {
        const p = pk[i] || {};
        return {
          format: FORMAT_LD[String(x.musicReleaseFormat).replace(/^.*\//, '')] || '',
          name: (x.name || p.title || '').trim(),
          type: (p.type_name || p.type_title || '').trim(),
          desc: (x.description || p.description || '').trim(),
          catno: (x.catalogNumber || p.catalog_number || p.sku || '').toString().trim(),
          date: (ymd(p.release_date || p.new_date) || []).join('-'),
          edition: p.edition_size || ''
        };
      });
      if (!physical.length) pk.forEach((p) => physical.push({
        format: /vinyl|record|lp\b|7"|10"|12"/i.test(p.type_name || p.title || '') ? 'Vinyl' : /cassette|tape/i.test(p.type_name || p.title || '') ? 'Cassette' : /\bcd\b|compact disc/i.test(p.type_name || p.title || '') ? 'CD' : '',
        name: (p.title || '').trim(), type: (p.type_name || '').trim(), desc: (p.description || '').trim(),
        catno: (p.catalog_number || p.sku || '').toString().trim(), date: (ymd(p.release_date || p.new_date) || []).join('-'), edition: p.edition_size || ''
      }));

      return {
        source: 'Bandcamp',
        url: location.origin + location.pathname,
        artist,
        artistSearch: artist,
        title,
        year, month, day,
        labels,
        country: '',
        formatName: 'File',
        boxSet: false,
        various: isVarious(artist),
        descriptions: [],
        formatTexts: [],
        tracks,
        credits: [],
        typeHint: isTrack && !partOfAlbum ? 'i' : '',
        // tag della pagina (servono per riconoscere le colonne sonore) e testi "about"/"credits"
        styles: [...document.querySelectorAll('.tralbum-tags a, a.tag')].map((a) => a.textContent.trim()).filter(Boolean),
        notes: [...document.querySelectorAll('.tralbum-about, .tralbum-credits')].map((e) => e.textContent).join('\n') ||
          [tr?.current?.about, tr?.current?.credits].filter(Boolean).join('\n'),
        cc: !!document.querySelector('#license a[href*="creativecommons.org"], a[href*="creativecommons.org/licenses"]'),
        selfReleased: labels.length === 0,
        streaming: true,
        lossless: downloadable !== false,      // i download Bandcamp includono FLAC/ALAC/WAV
        streamingOnly: downloadable === false,
        downloadUnknown: downloadable === null,
        oldDate,
        relDate, pubDate, lateUpload,
        partOfAlbum,
        preorder: !!(tr?.album_is_preorder || tr?.is_preorder),
        artUrl, noArt: !artId, embed,
        physical,
        labelLocation: (ld?.publisher?.foundingLocation?.name || '').trim()
      };
    }
    return;
  }


  // =====================================================================
  //  LATO Rym
  // =====================================================================
  if (!host.endsWith('rateyourmusic.com')) return;
  const form = document.getElementById('release_ac');
  if (!form) return; // solo sulla pagina "Add Release"

  const W = unsafeWindow;
  let D = null;          // release attualmente caricata
  let SRC = 'Discogs';
  let rawSeen = null;    // JSON già letto (per capire se è arrivata una release nuova)
  let filledRaw = null;  // JSON usato per l'ultima compilazione
  let capsMode = null;   // capitalizzazione: null = automatica (dalla lingua), true = inglese, false = solo iniziale
  let durVinyl = false;  // vinili: importa il minutaggio (solo se stampato sul disco)
  // quello che lo script ha modificato, per poterlo annullare prima di compilare un'altra release
  const touched = { attribs: new Set(), notesUrl: '', tracks: false, fields: new Set(), credits: [], radios: new Set() };
  let settingsChanged = false;
  // maiuscole come sulla fonte: per le eccezioni ammesse dalla wiki (nomi e titoli con grafia ufficiale)
  let keepCaps = false;
  let lastReport = null;
  // Dati salvati: solo un oggetto con i campi del tipo atteso (scarta dati corrotti o di versioni strane)
  function sanitize(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const str = (v) => (v == null ? '' : String(v));
    const arr = (v) => (Array.isArray(v) ? v : []);
    ['descriptions', 'formatTexts', 'vinylTexts', 'credits', 'genres', 'styles', 'performers', 'featured'].forEach((k) => { o[k] = arr(o[k]).filter((x) => typeof x === 'string'); });
    o.labels = arr(o.labels).filter((l) => l && typeof l === 'object').map((l) => ({ name: str(l.name), catno: str(l.catno), noCat: !!l.noCat }));
    o.tracks = arr(o.tracks).filter((t) => t && typeof t === 'object').map((t) => Object.assign({}, t, { pos: str(t.pos), title: str(t.title), dur: str(t.dur), artist: str(t.artist) }));
    ['title', 'artist', 'artistSearch', 'year', 'month', 'day', 'country', 'formatName', 'url', 'notes',
      'relDate', 'pubDate', 'artUrl', 'embed', 'labelLocation', 'oldDate'].forEach((k) => { o[k] = str(o[k]); });
    ['rightsSocieties', 'series', 'mainDescriptions'].forEach((k) => { o[k] = arr(o[k]).filter((x) => typeof x === 'string'); });
    const objs = (v) => arr(v).filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    o.artistsList = objs(o.artistsList).map((a) => ({ name: str(a.name), anv: str(a.anv), join: str(a.join), various: !!a.various }));
    o.creditList = objs(o.creditList).map((c) => ({ name: str(c.name), role: str(c.role), tracks: str(c.tracks) }));
    o.companies = objs(o.companies).map((c) => ({ name: str(c.name), role: str(c.role) }));
    o.formatsAll = objs(o.formatsAll).map((f) => ({ name: str(f.name), qty: str(f.qty), descriptions: arr(f.descriptions).filter((x) => typeof x === 'string'), text: str(f.text) }));
    o.physical = objs(o.physical).map((p) => ({ format: str(p.format), name: str(p.name), type: str(p.type), desc: str(p.desc), catno: str(p.catno), date: str(p.date), edition: str(p.edition) }));
    o.tracks.forEach((t) => { t.artists = arr(t.artists).filter((x) => typeof x === 'string'); });
    return o;
  }

  // Legge i dati salvati (o quelli passati dal listener); true se è arrivata una release più recente
  function loadData(rawArg) {
    const raw = rawArg !== undefined ? rawArg : GM_getValue(KEY);
    if (!raw || raw === rawSeen) return false;
    let parsed;
    try { parsed = sanitize(JSON.parse(raw)); } catch (e) { parsed = null; }
    if (!parsed) { GM_deleteValue(KEY); return false; }
    // mai tornare a una release più vecchia di quella già mostrata
    if (D && (parsed.savedAt || 0) < (D.savedAt || 0)) return false;
    rawSeen = raw;
    D = parsed;
    capsMode = null; // nuova release: capitalizzazione di nuovo automatica
    keepCaps = false;
    durVinyl = false;
    SRC = D.source || 'Discogs';
    return true;
  }

  // ---- mappature verso i valori del modulo Rym ----
  const FORMAT = {
    'Vinyl': 95, 'Lathe Cut': 95, 'Flexi-disc': 95, 'Shellac': 96, 'CD': 60, 'CDr': 32, 'DVD': 78, 'DVDr': 100,
    'Blu-ray': 88, 'Cassette': 66, 'Reel-To-Reel': 92, '8-Track Cartridge': 21, 'VHS': 40, 'Minidisc': 48,
    'SACD': 76, 'HDCD': 83, 'DualDisc': 54, 'Laserdisc': 89, 'Acetate': 80, 'DAT': 104, 'DCC': 105,
    'Microcassette': 101, 'Betamax': 41, 'Cylinder': 91, 'UMD': 81, 'VCD': 79, 'File': 58,
    'HD DVD': 78, 'HD DVD-R': 100, 'Blu-ray-R': 88, 'Pathé Disc': 95, 'Edison Disc': 95, '4-Track Cartridge': 103,
    'PlayTape': 102, 'Elcaset': 66, 'DC-International': 66, 'Pocket Rocker': 66, 'Tefifon': 66, 'Sabamobil': 66,
    'NT Cassette': 101, 'Betacam': 41, 'Betacam SP': 41, 'Cartrivision': 40, 'MiniDV': 40, 'U-matic': 40,
    'Video 2000': 40, 'Video8': 40, 'CDV': 89, 'SelectaVision': 89, 'VHD': 89, 'MVD': 48, 'AVCD': 79, 'SVCD': 79,
    'Floppy Disk': 58, 'Memory Stick': 58, 'Film Reel': 92
  };
  // formati video: il tipo di release è Video (o Music video per un solo brano)
  const VIDEO_FMTS = [78, 100, 88, 40, 41, 89, 79, 81];
  // limite minimo plausibile dell'anno per formato (prima di quell'anno il formato non esisteva o quasi)
  const FORMAT_YEAR = { 60: 1982, 32: 1990, 83: 1995, 54: 2004, 76: 1999, 78: 1996, 100: 1997, 77: 2000, 62: 2003, 88: 2006, 48: 1992,
    104: 1987, 105: 1992, 66: 1963, 101: 1969, 21: 1964, 103: 1962, 102: 1966, 40: 1976, 41: 1975, 89: 1978, 79: 1993, 81: 2004, 58: 2000, 59: 2000 };
  const DISC_SIZE = { '12"': 88, '10"': 89, '7"': 90, '5"': 91, '3"': 92, '16"': 93, '11"': 94, '9"': 95, '8"': 96, '6"': 97, '4"': 98 };
  const OPTICAL_ALL = [60, 32, 78, 100, 77, 88, 76, 83, 54, 89, 79, 81, 62];
  // Descrizioni ufficiali Discogs -> attributi Rym (id verificati sul modulo Rym)
  const ATTRIB = {
    'Remastered': 23, 'Limited Edition': 16, 'Numbered': 73, 'Promo': 11, 'Deluxe Edition': 59, 'Mono': 75,
    'Test Pressing': 108, 'White Label': 107, 'Picture Disc': 31, 'Single Sided': 104, 'Etched': 105,
    'Quadraphonic': 103, 'Enhanced': 63, 'Copy Protected': 61, 'Censored': 47, 'Special Edition': 49,
    'SHM-CD': 86, 'Box Set': 12, 'Advance': 11, 'Transcription': 11, 'Club Edition': 38, '2-Track Mono': 75, '4-Track Mono': 75
  };
  // Velocità: Discogs le mette nelle descrizioni ("33 ⅓ RPM", "7 ½ ips"); regex per tollerare varianti
  const SPEEDS = [
    [/^16\s*(⅔|2\/3)?\s*rpm$/i, 40, '16 rpm'], [/^33\s*(⅓|1\/3)?\s*rpm$/i, 19, '33 rpm'], [/^45\s*rpm$/i, 41, '45 rpm'],
    [/^78\s*rpm$/i, 42, '78 rpm'], [/^80\s*rpm$/i, 112, '80 rpm'],
    [/^3\s*(¾|3\/4)\s*ips$|^3\.75\s*ips$/i, 113, '3¾ IPS'], [/^7\s*(½|1\/2)\s*ips$|^7\.5\s*ips$/i, 114, '7½ IPS']
  ];
  // Peso: su Discogs NON è una descrizione, sta nel testo libero del formato ("180g", "180 Gram", "180gr")
  const WEIGHTS = { 120: 43, 140: 115, 150: 116, 160: 117, 180: 44, 200: 118, 220: 119 };
  const WEIGHT_RE = /\b(120|140|150|160|180|200|220)\s*-?\s*(g|gr|grams?|grammes?)\b/i;
  // Indizi dal testo libero del formato (e dal titolo dove serve), per tutte le spunte "Issue attributes" di Rym.
  // [regex, id Rym, nome, formati Rym ammessi (null = tutti), cerca anche nel titolo]
  const VINYL = [95, 96];
  const OPTICAL = [60, 32, 78, 100, 88, 76, 83, 54, 89, 79, 81];
  const DVD = [78, 100];
  const TEXT_ATTRIBS = [
    // Content
    [/abridged/i, 37, 'Abridged', null, false],
    [/bonus\s*cd/i, 50, 'Bonus CD', null, false],
    [/bonus\s*dvd/i, 51, 'Bonus DVD', null, false],
    [/bonus\s*(usb|flash)/i, 82, 'Bonus Flash Drive', null, false],
    [/bonus\s*tracks?/i, 62, 'Bonus Tracks', null, true],
    [/\bcensored\b|\bclean (version|edit)\b/i, 47, 'Censored', null, true],
    [/copy[\s-]?(protected|control)/i, 61, 'Content/Copy Protected', null, false],
    [/duophonic|re-?channell?ed|electronically re-?processed|simulated stereo|fake stereo/i, 102, 'Duophonic', null, false],
    [/\bmono\b/i, 75, 'Mono', null, false],
    [/quadraphonic|\bquad\b/i, 103, 'Quadraphonic', null, false],
    [/remaster/i, 23, 'Remastered', null, false],
    [/re-?recorded|taylor'?s version/i, 29, 'Re-recorded', null, true],
    [/single[\s-]?sided/i, 104, 'Single-sided', null, false],
    // Release type
    [/\banniversary\b/i, 120, 'Anniversary Edition', null, true],
    [/box\s*set/i, 12, 'Box Set', null, false],
    [/collector'?s edition|special edition/i, 49, 'Collector\'s Edition', null, true],
    [/deluxe (edition|version)/i, 59, 'Deluxe Edition', null, true],
    [/\bexclusive\b/i, 72, 'Exclusive', null, false],
    [/fan\s*club/i, 38, 'Fan Club Release', null, false],
    [/limited (edition|to \d)|\bltd\b/i, 16, 'Limited Edition', null, false],
    [/\bnumbered\b/i, 73, 'Numbered Edition', null, false],
    [/\bpromo\b/i, 11, 'Promo', null, false],
    // Package type
    [/amaray|keep\s*case/i, 67, 'Amaray Case', OPTICAL, false],
    [/mini[\s-]?lp|lp[\s-]?replica|replica (sleeve|jacket)/i, 60, 'CD Sized Album Replica', OPTICAL, false],
    [/digibook/i, 109, 'Digibook', null, false],
    [/digi-?pac?k/i, 21, 'Digipak', null, false],
    [/gatefold/i, 30, 'Gatefold', null, false],
    [/hand-?made/i, 33, 'Handmade', null, false],
    [/jewel\s*case/i, 76, 'Jewel Case (DVD only)', DVD, false],
    [/slide-?pac|music-?pac/i, 110, 'MusicPac / SlidePac', OPTICAL, false],
    [/(card(board)?|paper)[\s-]?sleeve|cardsleeve/i, 81, 'Paper/Cardboard Sleeve', OPTICAL, false],
    [/\bslip-?(case|cover)\b|\bo-?card\b/i, 111, 'Slipcase / O-Card', null, false],
    [/\busb\b|flash\s*drive/i, 80, 'USB/Flash Drive', null, false],
    // Vinyl specs
    [/etched/i, 105, 'Etched', VINYL, false],
    [/flexi/i, 66, 'Flexi-disc', VINYL, false],
    [/multi-?groove/i, 106, 'Multi-Groove', VINYL, false],
    [/picture\s*disc/i, 31, 'Picture Disc', VINYL, false],
    [/test\s*pressing/i, 108, 'Test Pressing', VINYL, false],
    [/white\s*label/i, 107, 'White Label', VINYL, false],
    // Manufacturing
    [/\bgold\s*(cd|disc)\b|24\s*k(t|arat)?\b/i, 52, 'Gold Disc', OPTICAL, false],
    [/\bshm\b|shm-?(cd|sacd)/i, 86, 'SHM', OPTICAL, false]
  ];

  // Colored vinyl: qualunque colore nel testo del vinile, tranne il nero e le parti che parlano d'altro (etichette, copertina…)
  const COLOR_WORDS = /\b(red|blue|green|yellow|orange|pink|purple|violet|white|clear|transparent|translucent|gold(en)?|silver|marbled?|marble|splatter(ed)?|swirl(ed)?|smok(e|y)|gr[ae]y|brown|colou?red|multi-?colou?r(ed)?|cream|bone|beige|olive|teal|magenta|turquoise|ruby|amber|tan|maroon|mint|lilac|lavender|aqua|cyan|coral|peach|bronze|copper|rose|crystal|milky|opaque|neon|glow[\s-]in[\s-]the[\s-]dark|galaxy|tri-?colou?r|coke\s*bottle|sea\s*(blue|glass|foam)|oxblood|burgundy|indigo|navy|lime|khaki|sand|ivory|pearl|fluorescent|tie[\s-]dye|cloudy|vortex|haze|bubblegum)\b/i;
  const NOT_VINYL = /\b(labels?|sleeves?|cover|insert|obi|jacket|poster|sticker|printed|print|booklet|inner|outer|spine|lettering|logo|box|case|shell)\b/i;
  function isColored(texts) {
    return texts.join(',').split(/[,;\/+&]|\band\b|\bwith\b/i).some((part) => COLOR_WORDS.test(part) && !NOT_VINYL.test(part));
  }

  // ---- Attributi di performance (wiki "Release attributes" §1) ----
  // Basati sui titoli delle tracce: soglie Rym >50% (o ≥20% ciascuno se insieme superano il 50%).
  const PERF = {
    // "(Live)", "[Live at…]", "Live at/in/from…", "- Live" a fine titolo (non "Band - Live Forever")
    live: /\(live\b|\[live\b|\blive (at|in|from|on|version|recording)\b|\s[-–]\s*live(\s+(at|in|from|on|version|recording)\b|\s*$)/i,
    remix: /\b(remix(ed)?|rmx|re-?mix|rework(ed)?|re-?edit|vip mix|dub mix)\b/i
  };
  // Contenuti da "Additional release" (§1.2.2): [regex, id, nome]
  const ADDITIONAL = [
    [/\binstrumentals?\b/i, 127, 'Instrumental'],
    [/a\s?capp?ella/i, 124, 'A capella'],
    [/\(demo\b|\[demo\b|\bdemo (version|recording|take)\b|\s[-–]\s*demo\b/i, 129, 'Demo recordings'],
    [/karaoke/i, 125, 'Karaoke'],
    [/\bstems\b|\(stem\)|\bstem (mix|version)\b/i, 126, 'Stems'],
    [/\b(peel|bbc|radio|studio|maida vale|kexp|tiny desk|daytrotter|kcrw|live) sessions?\b|\([^)]*\bsession\b[^)]*\)/i, 131, 'Live sessions'],
    [/outtakes?|alternate (take|version|mix)|\balt\.? take\b|\btake \d+\b/i, 128, 'Outtakes'],
    [/interview/i, 14, 'Interview'],
    [/commentary/i, 130, 'Commentary']
  ];

  // ---- Paesi: Discogs -> nomi Rym ----
  // Discogs usa sigle (US, UK) e regioni. Rym accetta i paesi e "Europe"; le altre aree restano vuote (vuoto = mondiale).
  // Elenco ufficiale dei paesi di Rym (dal suggerimento del modulo "Add Release": /sourced/autosuggest.js?pre=country)
  const RYM_COUNTRIES = ['Europe', 'Asia', 'Afghanistan', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla', 'Antarctica', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Aruba', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bermuda', 'Bhutan', 'Bolivia', 'Bonaire, Sint Eustatius, and Saba', 'Bosnia-Herzegovina', 'Botswana', 'Bouvet Island', 'Brazil', 'British Indian Ocean Territory', 'British Virgin Islands', 'Brunei Darussalam', 'Bulgaria', 'Burkina Faso', 'Burma', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Canary Islands', 'Cape Verde', 'Cayman Islands', 'Central African Republic', 'Chad', 'Chile', 'China', 'Christmas Island', 'Cocos Island', 'Colombia', 'Comoros', 'Congo', 'Cook Islands', 'Costa Rica', 'Croatia', 'Cuba', 'Curaçao', 'Cyprus', 'Czechia', 'Czechoslovakia (Former)', 'Democratic Republic of Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'East Timor', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Falkland Islands', 'Faroe Islands', 'Fiji', 'Finland', 'France', 'French Guiana', 'French Southern Territories', 'FYRO Macedonia', 'Gabon', 'Gambia', 'Georgia', 'Georgia & Sandwich Islands', 'Germany', 'Ghana', 'Gibraltar', 'Greece', 'Greenland', 'Grenada', 'Guadeloupe', 'Guam', 'Guatemala', 'Guernsey', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Heard Island and McDonald Islands', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jersey', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Martinique', 'Mauritania', 'Mauritius', 'Mayotte', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Montserrat', 'Morocco', 'Mozambique', 'Myanmar (Former Burma)', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'Netherlands Antilles', 'New Caledonia', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Niue', 'Norfolk Island', 'Northern Marianas', 'North Korea', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine National Authority', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Pitcairn Islands', 'Poland', 'Polynesia', 'Portugal', 'Puerto Rico', 'Qatar', 'Reunion', 'Romania', 'Russian Federation', 'Rwanda', 'Saint Barthélemy', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Martin (French)', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome', 'Saudi Arabia', 'Senegal', 'Serbia', 'Serbia and Montenegro (obsolete)', 'Seychelles', 'Sierra Leone', 'Singapore', 'Sint Maarten (Dutch part)', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'St. Helena', 'St Pierre And Miquelon', 'Sudan', 'Suriname', 'Svalbard And Jan Mayen', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tokelau', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Turks And Caicos Islands', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'US Minor Outlying Islands', 'US-Western Sahara', 'Uzbekistan', 'Vanuatu', 'Vatican City State', 'Venezuela', 'Vietnam', 'Virgin Islands', 'Wallis And Futuna Islands', 'Yemen', 'Zambia', 'Zimbabwe'];
  const RYM_BY_LOW = new Map(RYM_COUNTRIES.map((n) => [n.toLowerCase(), n]));
  // Nomi Discogs diversi da quelli Rym (chiave in minuscolo; più paesi = elenco)
  const COUNTRY_ALIAS = {
    'us': 'United States', 'usa': 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States',
    'uk': 'United Kingdom', 'u.k.': 'United Kingdom', 'england': 'United Kingdom', 'scotland': 'United Kingdom',
    'wales': 'United Kingdom', 'northern ireland': 'United Kingdom', 'great britain': 'United Kingdom',
    'benelux': ['Belgium', 'Netherlands', 'Luxembourg'],
    'russia': 'Russian Federation', 'czech republic': 'Czechia', 'czechoslovakia': 'Czechoslovakia (Former)',
    'bosnia & herzegovina': 'Bosnia-Herzegovina', 'bosnia and herzegovina': 'Bosnia-Herzegovina',
    'antigua & barbuda': 'Antigua and Barbuda', 'trinidad & tobago': 'Trinidad and Tobago',
    'serbia and montenegro': 'Serbia and Montenegro (obsolete)', 'serbia & montenegro': 'Serbia and Montenegro (obsolete)',
    'north macedonia': 'FYRO Macedonia', 'macedonia': 'FYRO Macedonia', 'moldova, republic of': 'Moldova',
    'brunei': 'Brunei Darussalam', 'myanmar': 'Myanmar (Former Burma)', "côte d'ivoire": 'Ivory Coast', "cote d'ivoire": 'Ivory Coast',
    'congo, republic of the': 'Congo', 'republic of the congo': 'Congo', 'congo, democratic republic of the': 'Democratic Republic of Congo',
    'democratic republic of the congo': 'Democratic Republic of Congo', 'zaire': 'Democratic Republic of Congo',
    'swaziland': 'Eswatini', 'macao': 'Macau', 'micronesia, federated states of': 'Micronesia', 'palestine': 'Palestine National Authority',
    'vatican city': 'Vatican City State', 'vatican': 'Vatican City State', 'réunion': 'Reunion', 'sao tome and principe': 'Sao Tome',
    'são tomé and príncipe': 'Sao Tome', 'wallis and futuna': 'Wallis And Futuna Islands', 'saint pierre and miquelon': 'St Pierre And Miquelon',
    'saint helena': 'St. Helena', 'us virgin islands': 'Virgin Islands', 'u.s. virgin islands': 'Virgin Islands',
    'northern mariana islands': 'Northern Marianas', 'french polynesia': 'Polynesia', 'pitcairn': 'Pitcairn Islands',
    'heard and mcdonald islands': 'Heard Island and McDonald Islands', 'south georgia and the south sandwich islands': 'Georgia & Sandwich Islands',
    'cocos (keeling) islands': 'Cocos Island', 'saint martin': 'Saint Martin (French)', 'sint maarten': 'Sint Maarten (Dutch part)',
    'bonaire': 'Bonaire, Sint Eustatius, and Saba', 'caribbean netherlands': 'Bonaire, Sint Eustatius, and Saba',
    'korea, republic of': 'South Korea', 'republic of korea': 'South Korea', 'iran, islamic republic of': 'Iran',
    'syrian arab republic': 'Syria', 'viet nam': 'Vietnam', 'lao pdr': 'Laos', 'türkiye': 'Turkey', 'turkiye': 'Turkey',
    'the netherlands': 'Netherlands', 'holland': 'Netherlands', 'east timor': 'East Timor', 'timor-leste': 'Timor-Leste'
  };
  // Nomi con "&", "and" o virgole da non spezzare (chiavi dell'elenco sopra e nomi Rym composti)
  const COMPOUND = Object.keys(COUNTRY_ALIAS).concat(RYM_COUNTRIES.map((n) => n.toLowerCase()))
    .filter((k) => /,|&|\band\b/i.test(k)).sort((a, b) => b.length - a.length);
  // Aree di Discogs senza corrispondenza su Rym (Rym accetta solo "Europe" e "Asia"): restano vuote (vuoto = mondiale)
  const REGIONS = /^(worldwide|scandinavia|north america|south america|central america|latin america|africa|australasia|oceania|middle east|gulf cooperation council|eastern europe|unknown)$/i;
  function mapCountries(c) {
    const out = [], skipped = [], unknown = [];
    let txt = c || '';
    const kept = [];
    COMPOUND.forEach((k) => {
      const re = new RegExp(escRe(k), 'i');
      if (re.test(txt)) { kept.push(k); txt = txt.replace(re, '§' + (kept.length - 1) + '§'); }
    });
    txt.split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean).forEach((p0) => {
      const p = p0.replace(/§(\d+)§/g, (all, i) => kept[+i]);
      const alias = COUNTRY_ALIAS[p.toLowerCase()];
      if (alias) [].concat(alias).forEach((a) => out.push(a));
      else if (RYM_BY_LOW.has(p.toLowerCase())) out.push(RYM_BY_LOW.get(p.toLowerCase()));
      else if (REGIONS.test(p)) skipped.push(p);
      else unknown.push(p); // es. "USSR", "Yugoslavia": non esistono nell'elenco Rym
    });
    return { value: [...new Set(out)].join(', '), skipped, unknown };
  }

  // ---- regole Rym sui tipi di release (wiki "Release types") ----
  const TYPE_NAME = { s: 'Album', c: 'Compilation', e: 'EP', i: 'Single', m: 'Mixtape', x: 'Additional', j: 'DJ Mix', b: 'Bootleg', o: 'Music video', d: 'Video' };
  // formati a due lati: titolo del singolo = "Brano A / Brano B"
  const TWO_SIDED = ['Vinyl', 'Lathe Cut', 'Flexi-disc', 'Shellac', 'Cassette', 'Microcassette', 'Reel-To-Reel', '8-Track Cartridge', 'Acetate'];
  const ALBUM_MIN = 28 * 60; // Rym: un album dura di solito almeno 28 minuti
  const VERSION_WORDS = /\b(remix(es)?|rmx|mix|edit|dub|version|instrumental|inst|instr|rework|re-?edit|radio|extended|club|a ?capp?ella|vip|bootleg|reprise|mono|stereo|live|demo|acoustic|original|remaster(ed)?|vocal|beats|clean|explicit|dirty|feat|ft|featuring)\b/i;

  // "3:45" / "1:02:05" -> secondi; vuoto -> null
  function durSec(t) {
    if (!t) return null;
    const p = String(t).split(':').map(Number);
    if (p.some(isNaN)) return null;
    return p.reduce((a, v) => a * 60 + v, 0);
  }

  // nome "generico" del brano: senza sottotitoli di versione ("(Radio Edit)", "[Dub Mix]", "- Club Mix")
  function genericTitle(t) {
    let s = (t || '').trim(), prev;
    do {
      prev = s;
      s = s.replace(/\s*[(\[]([^)\]]*)[)\]]\s*$/, (m, inner) => (VERSION_WORDS.test(inner) ? '' : m));
      // "- Club Mix": solo se la parte dopo il trattino FINISCE con una parola di versione
      // (così "Band - Live Forever" non viene tagliato)
      s = s.replace(/\s+[-–]\s+[^-–]*$/, (m) => (/\b(remix|rmx|mix|edit|dub|version|instrumental|rework|re-?edit|vip|a ?capp?ella|vocal|beats|clean|explicit|dirty)\s*$/i.test(m) ? '' : m));
    } while (s !== prev);
    return s.trim();
  }

  // "EP", "E.P.", "E.P", "(EP)", "Mini Album", "Mini-Album"
  const hasEpMarker = (title) => /(^|[\s(\[:\-–])e\.?\s?p\.?(?=$|[\s)\]:,\-–])/i.test(title || '') || /\bmini[\s-]?album\b/i.test(title || '');

  // Restituisce { type, reason, sure }: "sure" = dichiarato dalla fonte, altrimenti stima
  // descrizioni del supporto principale: un 7" bonus o un sampler allegato non cambiano tipo e misura
  const mainDesc = () => (D.source === 'Discogs' && (D.mainDescriptions || []).length ? D.mainDescriptions : (D.descriptions || []));
  function guessType(fmt, size) {
    const desc = mainDesc();
    const tracks = (D.tracks || []).filter((t) => !t.header); // le intestazioni delle opere non sono tracce
    const n = tracks.length;
    const known = tracks.map((t) => durSec(t.dur)).filter((x) => x != null);
    const sum = known.reduce((a, b) => a + b, 0);
    const complete = n > 0 && known.length === n;
    const long = sum >= ALBUM_MIN; // anche con durate parziali, se già si superano i 28 minuti
    const mins = complete ? Math.round(sum / 60) + ' min' : (sum ? 'oltre ' + Math.round(sum / 60) + ' min' : 'durata ignota');

    // video (concerti, raccolte di videoclip): tipo Video; un solo brano = Music video
    if (VIDEO_FMTS.includes(fmt)) {
      if (n === 1 || desc.includes('Single')) return { type: 'o', reason: say('video di un solo brano', 'single-song video'), sure: false };
      return { type: 'd', reason: say('formato video', 'video format') + ' (' + D.formatName + ')', sure: [40, 41, 89].includes(fmt) };
    }

    if (desc.includes('Unofficial Release')) return { type: 'b', reason: 'non ufficiale su Discogs', sure: true };
    if (desc.includes('Mixed')) return { type: 'j', reason: '"Mixed" su Discogs', sure: true };
    if (desc.includes('Mixtape')) return { type: 'm', reason: '"Mixtape" su Discogs', sure: true };
    if (desc.includes('Compilation')) return { type: 'c', reason: '"Compilation" su Discogs', sure: true };
    if (desc.includes('EP') || desc.includes('Mini-Album')) return { type: 'e', reason: 'EP su Discogs', sure: true };
    if (hasEpMarker(D.title)) return { type: 'e', reason: 'EP nel titolo', sure: true };
    if (desc.includes('Single') || desc.includes('Maxi-Single')) return { type: 'i', reason: 'Single su Discogs', sure: true };
    if (D.typeHint === 'i') return { type: 'i', reason: 'pagina di una singola traccia', sure: true };
    if (desc.includes('Album') || desc.includes('LP')) return { type: 's', reason: 'Album/LP su Discogs', sure: true };

    // --- stima ---
    // Senza tracklist (frequente su Discogs) restano solo gli indizi del formato
    if (!n) {
      if (size === '7"') return { type: 'i', reason: '7" senza tracklist', sure: false };
      if (fmt === 95 && size === '12"') return { type: 'i', reason: '12" senza "LP" né tracklist (tipico 12" club)', sure: false };
      return { type: 's', reason: 'nessuna tracklist', sure: false, unknown: true };
    }
    const bases = new Set(tracks.map((t) => genericTitle(t.title).toLowerCase()));
    // "Untitled" ripetuto non vuol dire "versioni dello stesso brano"
    const untitledAll = tracks.every((t) => /^[\[(]?\s*untitled\s*[\])]?$/i.test((t.title || '').trim()));
    if (n >= 2 && bases.size === 1 && !untitledAll) return { type: 'i', reason: n + ' versioni dello stesso brano', sure: false };
    // vinile 7"/10"/12" che Discogs non indica come LP: fino a 3 tracce singolo; da 4 a 6 EP,
    // salvo durata totale oltre 30 minuti (album). I 12" da club superano spesso i 28 minuti di un album.
    if (fmt === 95 && ['7"', '10"', '12"'].includes(size) && !desc.includes('LP') && n <= 6) {
      if (n <= 3) return { type: 'i', reason: size + ' non LP, ' + n + ' tracce, ' + mins, sure: false };
      if (sum > 30 * 60) return { type: 's', reason: size + ' non LP, ' + n + ' tracce ma ' + mins, sure: false };
      return { type: 'e', reason: size + ' non LP, ' + n + ' tracce, ' + mins, sure: false };
    }
    if (n <= 3) {
      if (long) return { type: 's', reason: n + ' tracce ma ' + mins, sure: false };
      return { type: 'i', reason: n + ' tracce, ' + mins, sure: false };
    }
    if (size === '7"' && n <= 4) return { type: 'e', reason: '7" con ' + n + ' tracce', sure: false };
    if (n <= 7) {
      if (long) return { type: 's', reason: n + ' tracce, ' + mins, sure: false };
      return { type: 'e', reason: n + ' tracce, ' + mins, sure: false };
    }
    return { type: 's', reason: n + ' tracce, ' + mins, sure: false };
  }

  // Titolo standard Rym per i singoli fisici (wiki "Release types" §4.1-4.2)
  function singleTitle(tracks) {
    const list = (tracks || []).filter((t) => !t.header);
    // titolo senza le parentesi finali: "As Long As It's Groovy (Shortly)" -> "As Long As It's Groovy"
    const base = (t) => (t || '').replace(/(\s*[(\[][^)\]]*[)\]])+\s*$/, '').trim();
    const count = {};
    const titleOf = (t) => t.plain || t.title; // nei V/A senza il nome dell'artista
    list.forEach((t) => { const b = base(titleOf(t)).toLowerCase(); count[b] = (count[b] || 0) + 1; });
    const seen = new Map();
    list.forEach((t) => {
      let g = genericTitle(titleOf(t));
      const b = base(titleOf(t));
      if (b && count[b.toLowerCase()] > 1) g = b; // stesso brano in più tracce: un solo nome, senza parentesi
      if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
    });
    const names = [...seen.values()];
    if (!names.length) return '';
    return TWO_SIDED.includes(D.formatName) ? names.join(' / ') : names[0];
  }


  // =====================================================================
  //  MAIUSCOLE Rym (wiki "Capitalization" e "Non-English Latin language capitalization")
  // =====================================================================
  // Inglese: maiuscola a ogni parola tranne articoli, congiunzioni coordinanti e preposizioni brevi;
  // sempre maiuscole la prima e l'ultima parola di ogni sezione (dopo : ? ! — ( " e " / ").
  // Altre lingue latine: solo la prima parola e i nomi propri -> non correggibile in automatico.
  const LOWER_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'as', 'at', 'by', 'in', 'of', 'on', 'to',
    'versus', 'vs', 'vs.', 'v.', 'etc', 'etc.', "o'", "'n'", "n'", "'n"]);
  const NEVER_FORCE = new Set(['versus', 'vs', 'vs.', 'v.', 'etc', 'etc.', "o'", "'n'", "n'", "'n"]); // minuscole anche se ultime ("Time After Time etc.")
  const AMBIGUOUS = new Set(['as', 'by', 'in', 'on', 'to', 'but', 'so']); // possono essere avverbi -> maiuscola
  const ACRONYMS = new Set(['DJ', 'MC', 'TV', 'USA', 'UK', 'NYC', 'NY', 'OK', 'EP', 'LP', 'CD', 'DVD', 'BBC', 'MTV', 'VIP', 'UFO', 'USSR', 'R&B', 'BPM', 'SOS', 'ASAP', 'FM', 'DC', 'AI', 'EU', 'UN']);
  const ROMAN = /^X{0,3}(IX|IV|V?I{0,3})$/;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Lingue con maiuscole "all'inglese" ma con eccezioni proprie (wiki "Non-English Latin language capitalization")
  const TITLE_LANGS = {
    tr: { low: new Set(['ve', 'ile', 'ya', 'veya', 'yahut', 'ki', 'da', 'de']), particle: /^m[ıiuü](s[ıiuü]n(ız|iz|uz|üz)?|y[ıiuü]m|y[ıiuü]z|d[ıiuü]r|yd[ıiuü]|ym[ıiuü]ş)?$/u, locale: 'tr' },
    id: { low: new Set(['para', 'si', 'sang', 'karena', 'pun', 'dong', 'kok', 'sih', 'di', 'ke', 'dari', 'pada', 'untuk', 'dengan', 'dan', 'atau', 'tapi', 'yang', 'dalam', 'oleh', 'bagi', 'akan', 'agar', 'bahwa']), locale: 'id', redup: true },
    tl: { low: new Set(['ang', 'ng', 'sa', 'mga', 'o', 'at', "'t"]), locale: 'fil' }
  };
  const CAP_EN = { low: LOWER_WORDS, never: NEVER_FORCE, locale: 'en', lang: 'en', particle: null, redup: false };
  let CAP = CAP_EN;
  const lower = (x) => x.toLocaleLowerCase(CAP.locale);
  const upper = (x) => x.toLocaleUpperCase(CAP.locale);

  function capFirst(p, mode) {
    const s = mode === 'mixed' ? p : lower(p);
    const i = s.search(/[\p{L}\p{N}]/u);
    if (i < 0 || /\p{N}/u.test(s.charAt(i))) return s; // "1st" resta "1st"
    return s.slice(0, i) + upper(s.charAt(i)) + s.slice(i + 1);
  }

  function capPiece(p, forceFirst, forceLast, mode, flags) {
    if (!/\p{L}/u.test(p)) return p;
    const key = lower(p.replace(/[’‘]/g, "'"));
    if (/^(\p{L}\.){2,}\p{L}?\.?$/u.test(p) && key !== 'a.k.a.') return mode === 'mixed' ? p : upper(p); // R.E.M.
    if (mode === 'mixed' && /\p{Lu}/u.test(p.replace(/^['’]+/, '').slice(1))) return p; // camelcase o sigla già scritta (McCartney, DJ, iPad); l'apostrofo iniziale non conta ("'Til")
    if (mode !== 'mixed') {
      const up = p.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      if (mode === 'upper' && up.length >= 2 && ROMAN.test(up)) return up; // numeri romani
    }
    if (CAP.lang === 'en' && (key === 'i' || /^i'/.test(key))) return 'I' + p.slice(1).toLowerCase(); // I, I'm, I'll
    const particle = !!(CAP.particle && CAP.particle.test(key));
    const force = forceFirst || (forceLast && !CAP.never.has(key) && !particle);
    if ((CAP.low.has(key) || particle) && !force) {
      if (CAP.lang === 'en' && AMBIGUOUS.has(key) && (mode !== 'mixed' || /^\p{Lu}/u.test(p))) flags.push(key);
      return lower(p);
    }
    return capFirst(p, mode);
  }

  function capWord(token, isFirst, isLast, mode, flags) {
    const m = token.match(/^([^\p{L}\p{N}'’]*)(.*?)([^\p{L}\p{N}'’.&]*)$/u);
    const pieces = m[2].split('-'); // composti col trattino: ogni parte come parola a sé ("Will-o'-the-Wisp", "Drive-In")
    const out = pieces.map((p, k) => capPiece(p, isFirst && k === 0, isLast && k === pieces.length - 1, mode, flags));
    // indonesiano: raddoppio parziale ("Berlompat-lompat") -> seconda parte minuscola
    if (CAP.redup && pieces.length === 2 && lower(pieces[0]) !== lower(pieces[1])) out[1] = lower(out[1]);
    return m[1] + out.join('-') + m[3];
  }

  function capSegment(seg, mode, flags) {
    const tokens = seg.split(/(\s+)/);
    const words = tokens.map((t, i) => (/[\p{L}\p{N}]/u.test(t) ? i : -1)).filter((i) => i >= 0);
    const first = words[0], last = words[words.length - 1];
    return tokens.map((t, i) => (words.includes(i) ? capWord(t, i === first, i === last, mode, flags) : t)).join('');
  }

  // Regole inglesi su un titolo. "protect" = nomi d'artista da lasciare come sono ("The Best of The Temptations")
  function capEN(str, protect, lang) {
    const prev = CAP;
    if (lang && TITLE_LANGS[lang]) CAP = Object.assign({}, CAP_EN, TITLE_LANGS[lang], { lang, never: new Set() });
    try { return capENcore(str, protect); } finally { CAP = prev; }
  }
  function capENcore(str, protect) {
    const src = str || '';
    const letters = src.replace(/[^\p{L}]/gu, '');
    const mode = !letters ? 'mixed' : letters === letters.toUpperCase() ? 'upper' : letters === letters.toLowerCase() ? 'lower' : 'mixed';
    const flags = [];
    const parts = src.split(/(\s*[:?!—()"“”\[\]]\s*|\s+\/\s+|\s+=\s+|\s+[-–]\s+)/);
    let text = parts.map((seg, i) => (i % 2 ? seg : capSegment(seg, mode, flags))).join('');
    (protect || []).forEach((name) => {
      if (!name || name.length < 3 || isVarious(name)) return;
      const re = new RegExp('(^|[^\\p{L}])(' + escRe(name) + ')(?=$|[^\\p{L}])', 'giu');
      text = text.replace(re, (all, pre) => pre + name);
    });
    return { text, flags, mode };
  }

  // Titoli non inglesi (wiki "Non-English Latin language capitalization"): maiuscola solo la prima parola
  // del titolo e di ogni sezione (dopo . : ? ! — ( " e " / "), il resto in minuscolo.
  // Restano come sono: sigle (DJ, R.E.M.), camelcase, numeri romani, abbreviazioni (Op., Vol., St.) e il nome dell'artista.
  // I nomi propri non si possono riconoscere: vanno controllati a mano.
  const ACRONYMS_SAFE = new Set(['DJ', 'MC', 'TV', 'USA', 'UK', 'NYC', 'CD', 'DVD', 'LP', 'EP', 'BBC', 'MTV', 'VIP', 'UFO', 'USSR', 'R&B', 'BPM', 'SOS', 'FM']);
  function sentencePiece(p, isFirst, mode) {
    if (!/\p{L}/u.test(p)) return p;
    // articolo eliso: "L'Uomo" -> "L'uomo", "Dell'Amore" -> "Dell'amore"
    const el = p.match(/^(\p{L}{1,4}['’])(\p{L}.*)$/u);
    if (el) return (isFirst ? capFirst(el[1].toLowerCase(), 'lower') : el[1].toLowerCase()) + sentencePiece(el[2], false, mode);
    if (/^(\p{L}\.){2,}\p{L}?\.?$/u.test(p)) return mode === 'mixed' ? p : p.toUpperCase();      // R.E.M.
    if (mode === 'mixed' && /\p{Lu}/u.test(p.replace(/^['’]+/, '').slice(1))) return p;            // DJ, McCartney (non "'Ntussicatu")
    if (mode === 'mixed' && /^\p{Lu}\p{Ll}{0,3}\.$/u.test(p)) return p;                           // Op., Vol., St., Nr.
    if (mode !== 'mixed' && ACRONYMS_SAFE.has(p.toUpperCase())) return p.toUpperCase();
    if (mode === 'upper' && p.length >= 2 && ROMAN.test(p)) return p;                              // II, IV
    const low = p.toLowerCase();
    return isFirst ? capFirst(low, 'lower') : low;
  }
  function capSentence(str, protect, lang) {
    const src = str || '';
    const letters = src.replace(/[^\p{L}]/gu, '');
    const mode = !letters ? 'mixed' : letters === letters.toUpperCase() ? 'upper' : letters === letters.toLowerCase() ? 'lower' : 'mixed';
    // francese: dopo " : ", " ! ", " ? " con lo spazio prima si continua in minuscolo ("Oxygène : la magie de la musique")
    const SPLIT = lang === 'fr' ? /(\s*[—()"“”\[\]]\s*|(?<=[^\s:?!])[:?!]\s*|\.\s+|\s+\/\s+|\s+=\s+|\s+[-–]\s+)/ : /(\s*[:?!—()"“”\[\]]\s*|\.\s+|\s+\/\s+|\s+=\s+|\s+[-–]\s+)/;
    const parts = src.split(SPLIT);
    let text = parts.map((seg, i) => {
      if (i % 2) return seg;
      let first = true;
      return seg.split(/(\s+)/).map((tok) => {
        if (!/[\p{L}\p{N}]/u.test(tok)) return tok;
        const m = tok.match(/^([^\p{L}\p{N}'’]*)(.*?)([^\p{L}\p{N}'’.&]*)$/u);
        const out = m[2].split('-').map((p, k) => sentencePiece(p, first && k === 0, mode)).join('-');
        first = false;
        return m[1] + out + m[3];
      }).join('');
    }).join('');
    (protect || []).forEach((name) => {
      if (!name || name.length < 3 || isVarious(name)) return;
      const re = new RegExp('(^|[^\\p{L}])(' + escRe(name) + ')(?=$|[^\\p{L}])', 'giu');
      text = text.replace(re, (all, pre) => pre + name);
    });
    // olandese: "IJ" è una lettera sola; "'s"/"'t" iniziali restano minuscoli e si alza la parola dopo
    if (lang === 'nl') {
      text = text.replace(/(^|[^\p{L}])Ij(?=\p{L})/gu, '$1IJ');
      text = text.replace(/^(['’])([st])\s+(\p{L})/iu, (all, ap, l, c) => ap + l.toLowerCase() + ' ' + c.toUpperCase());
    }
    return text;
  }

  // Lingua stimata dall'insieme di titolo + tracce (parole frequenti di ogni lingua)
  const LANG_WORDS = {
    en: 'the and of you your my me i in on to is it its love be all for with this that we are not what when dont cant im night day time from at by an so up out down baby girl heart man world one get go got just like let make never now oh way will been was were have has do yes into over as no he she they our his her but or if off only more how why who there here back again keep eyes long see gonna wanna gotta die everybody everybodys nobody somebody feel need want know say take give tell think look find good new old little big life home light dream lost mind free away high run dance music sky blue black fire two three four five six seven eight nine ten intro outro interlude reprise part theme song extra radio edit mix version',
    it: 'il lo la le gli i di del della dello dei delle degli che e è non per una un uno con ma mi ti si sei sono nel nella al alla ai come cosa quando tu io noi mio mia tuo tua ancora notte cuore vita sempre più perché se questa questo in',
    es: 'el los las del de que y en un una por con para mi tu te no es amor corazón noche vida como pero más sin yo soy eres está la',
    fr: 'le les des du de et est un une pour avec dans sur je tu il nous vous mon ma mes ton ta pas qui que au aux amour nuit cest jai ne la',
    de: 'der die das und ist ich du nicht ein eine mit von zu im auf für dem den wir sie es liebe nacht auch in',
    pt: 'o os as do da dos das que e um uma não em no na com por para meu minha você amor coração eu de',
    nl: 'de het een en van ik je niet op met voor zijn wat jij mijn in is',
    tr: 've ile bir bu ne için gibi çok sen ben benim senin seni beni aşk gece gün yok var mı mi değil ki ya ama gel git iyi kötü sevgili yar yarim güzel gönül dünya sevda kız olmaz',
    id: 'yang dan di ke dari aku kau kamu cinta untuk dengan tak tidak ini itu ada kita hati malam',
    tl: 'ang ng sa mga ko mo ikaw ako kita hindi pag-ibig mahal puso gabi'
  };
  const LANG_SETS = Object.fromEntries(Object.entries(LANG_WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));
  const LANG_NAME = { en: 'inglese', it: 'italiano', es: 'spagnolo', fr: 'francese', de: 'tedesco', pt: 'portoghese', nl: 'olandese', ru: 'russo', tr: 'turco', id: 'indonesiano', tl: 'filippino', zz: 'scrittura non latina', xx: 'non inglese' };
  // nomi delle lingue per il campo "Languages" di Rym (elenco ISO 639-1 in inglese)
  const RYM_LANG = { en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', tr: 'Turkish', id: 'Indonesian', tl: 'Tagalog' };
  // scritture: cirillico = regole russe; scritture senza maiuscole (o non coperte dalla wiki) = non toccare
  function scriptOf(text) {
    if (/\p{Script=Cyrillic}/u.test(text)) return 'ru';
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Greek}\p{Script=Georgian}\p{Script=Armenian}\p{Script=Ethiopic}]/u.test(text)) return 'zz';
    return null;
  }
  // lingua per il campo Languages a partire dalla scrittura
  function scriptLang(text) {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'Japanese';
    if (/\p{Script=Hangul}/u.test(text)) return 'Korean';
    if (/\p{Script=Han}/u.test(text)) return 'Chinese';
    if (/\p{Script=Arabic}/u.test(text)) return 'Arabic';
    if (/\p{Script=Hebrew}/u.test(text)) return 'Hebrew';
    if (/\p{Script=Thai}/u.test(text)) return 'Thai';
    if (/\p{Script=Greek}/u.test(text)) return 'Greek, Modern';
    if (/\p{Script=Devanagari}/u.test(text)) return 'Hindi';
    return '';
  }

  // Riserva quando non ci sono parole frequenti: nei titoli italiani/spagnoli/portoghesi e nei dialetti
  // (siciliano, napoletano: -u) quasi tutte le parole finiscono in a/i/o/u, in quelli inglesi quasi mai.
  // Le parole inglesi comuni ("you") non contano. Restituisce 'xx' (non inglese), 'en' o 'unknown'.
  function vowelGuess(text, hi, lo) {
    const words = (text || '').toLowerCase().replace(/[’']/g, '').split(/[^\p{L}]+/u).filter((w) => w.length >= 3 && !LANG_SETS.en.has(w));
    if (words.length < 2) return 'unknown';
    const r = words.filter((w) => /[aiouàòìùú]$/.test(w)).length / words.length;
    return r >= hi ? 'xx' : r <= lo ? 'en' : 'unknown';
  }

  // lingua solo se ci sono indizi forti (scrittura, lettere tipiche, almeno 2 parole riconosciute)
  function detectLangStrong(text) {
    const scr = scriptOf(text || '');
    if (scr) return scr;
    if (/[ğış]|İ/u.test(text || '')) return 'tr';
    const words = (text || '').toLowerCase().replace(/[’']/g, '').split(/[^\p{L}]+/u).filter(Boolean);
    const known = words.filter((w) => Object.keys(LANG_SETS).some((k) => LANG_SETS[k].has(w))).length;
    return known >= 2 ? detectLang(text, true) : 'unknown';
  }

  function detectLang(text, perTitle) {
    const scr = scriptOf(text || '');
    if (scr) return scr;
    // lettere tipiche del turco
    if (/[ğış]|İ/u.test(text || '')) return 'tr';
    const score = {};
    let hits = 0; // parole riconosciute in almeno una lista
    Object.keys(LANG_SETS).forEach((k) => { score[k] = 0; });
    // via le contrazioni inglesi ("o'", "'n'") che sembrerebbero articoli di altre lingue
    (text || '').toLowerCase().replace(/[’]/g, "'").replace(/(^|\s)(o|n)'(?=\s|$)|'n'/g, ' ').replace(/'/g, '').split(/[^\p{L}]+/u).filter(Boolean).forEach((w) => {
      const langs = Object.keys(LANG_SETS).filter((k) => LANG_SETS[k].has(w));
      if (langs.length) hits++;
      langs.forEach((k) => { score[k] += 1 / langs.length; });
    });
    // in un singolo titolo una sola parola non basta ("Original Sin": "sin" è anche spagnolo)
    if (perTitle && hits < 2) return vowelGuess(text, 0.6, 0.2);
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    const clear = ranked[0][1] >= 1 && !(ranked[1][1] > 0 && ranked[0][1] < 1.5 * ranked[1][1]); // non troppo incerto
    if (clear) return ranked[0][0];
    // indizi deboli ma tutti dalla stessa parte: solo parole di lingue non inglesi ("la", "del") -> non inglese
    const other = Object.keys(score).filter((k) => k !== 'en').reduce((a, k) => a + score[k], 0);
    if (score.en === 0 && other >= 0.5) return 'xx';
    if (other === 0 && score.en >= 0.5) return 'en';
    return perTitle ? vowelGuess(text, 0.6, 0.2) : vowelGuess(text, 0.5, 0.25);
  }

  // Posizioni delle tracce nello standard Rym (solo numeri o lato+numero):
  //  - punto finale e prefisso del supporto: "1." -> "1", "CD.1" -> "1", "DVD 3" -> "3", "CD.7a" -> "7a"
  //  - più dischi: "1-1", "CD2-03", "2.4" -> "1.1", "2.3", "2.4" (un solo disco: "1-5" -> "5")
  //  - supporti diversi (CD + DVD): una riga senza numero "CD" / "DVD" prima delle rispettive tracce,
  //    numerazione a due livelli 1.x / 2.x
  //  - lati: "A01" -> "A1"; lati non standard ("AA", "AA1", "BB") -> A, B, C... in ordine
  //  - un solo brano sul lato: "A1" -> "A"
  //  - numeri: "01" -> "1"
  const MEDIA_LABEL = { cd: 'CD', dvd: 'DVD', bluray: 'Blu-ray', bd: 'Blu-ray', sacd: 'SACD', vhs: 'VHS' };
  function normPositions(rows) {
    const tracks = rows.filter((t) => !t.header);
    const discRe = /^(?:disc|disk)?\s*(\d+)\s*[-–.]\s*0*(\d+)([a-z]?)$/i;
    const sideRe = /^([A-Z])(\1*)\s*0*(\d*)((?:[a-z]|\.\d+|\.[a-z])?)$/; // "A", "AA2", "A01", "A1a"

    // 1) punto finale e prefisso del supporto
    tracks.forEach((t) => {
      let p = (t.pos || '').trim().replace(/\.$/, '');
      const m = p.match(/^(cd|dvd|blu-?ray|bd|sacd|vhs)\s*[.:\-]?\s*(\d.*)$/i);
      if (m) { t.media = MEDIA_LABEL[m[1].toLowerCase().replace('-', '')]; p = m[2]; }
      t.pos = p;
    });

    // 2) numero di disco ("1-3", "2.10")
    tracks.forEach((t) => {
      const m = t.pos.match(discRe);
      if (m) { t.disc = +m[1]; t.pos = m[2] + m[3]; }
      // supporto e numero di disco dalle intestazioni Discogs ("CD 2", "DVD")
      if (!t.media && t.mediaHint) t.media = MEDIA_LABEL[String(t.mediaHint).toLowerCase().replace('-', '')] || '';
      if (!t.disc && t.discHint) t.disc = +t.discHint;
    });

    // 3) lati del vinile/cassetta
    const side = new Map(); // traccia -> { s: lato, n: numero, r: resto }
    // solchi paralleli (AA1, AB1…): posizioni lasciate come sono
    const parallel = tracks.some((t) => /^([A-Z])(?!\1)[A-Z]\d/.test((t.pos || '').trim()));
    tracks.forEach((t) => {
      if (t.disc || t.media || parallel) return;
      const m = t.pos.match(sideRe);
      if (!m) return;
      side.set(t, { s: (m[1] + m[2]).toUpperCase(), n: m[3], r: m[4] });
    });
    // Lettera ripetuta senza numero ("BB", "BBB") quando il lato esiste già: è la traccia 2, 3… di quel lato
    // (A, B, BB -> A, B1, B2). Eccezione: "A" + "AA" senza lato B è un singolo double A-side, AA è il retro (-> B).
    const singles = new Set([...side.values()].filter((v) => v.s.length === 1).map((v) => v.s));
    side.forEach((v) => {
      const X = v.s[0];
      if (v.s.length > 1 && !v.n && !v.r && singles.has(X) && (X !== 'A' || singles.has('B'))) { v.n = String(v.s.length); v.s = X; }
    });
    const order = [];
    side.forEach((v) => { if (!order.includes(v.s)) order.push(v.s); });
    const remap = order.some((x) => x.length > 1); // "AA" & co. rimasti: rinomina tutti i lati in ordine
    const letter = {};
    order.forEach((x, i) => { letter[x] = remap ? String.fromCharCode(65 + i) : x; });
    const perSide = {};
    side.forEach((v) => { perSide[v.s] = (perSide[v.s] || 0) + 1; });
    // su un lato con più tracce, quella senza numero è la prima ("B" -> "B1")
    side.forEach((v) => { if (perSide[v.s] > 1 && !v.n && !v.r) v.n = '1'; });
    side.forEach((v, t) => {
      const L = letter[v.s];
      t.pos = perSide[v.s] === 1 && !v.r ? L : L + (v.n ? String(+v.n) : '') + v.r;
    });

    // 4) zeri iniziali
    tracks.forEach((t) => { if (!side.has(t) && /^0+\d/.test(t.pos)) t.pos = t.pos.replace(/^0+(?=\d)/, ''); });

    // 5) numerazione finale e righe dei supporti
    let media = [...new Set(tracks.map((t) => t.media).filter(Boolean))];
    // un solo supporto con prefisso ("DVD1") e altre tracce senza: queste sono del supporto principale (es. CD)
    const baseLabel = MEDIA_LABEL[(D.formatName || '').toLowerCase().replace('-', '')];
    if (media.length === 1 && baseLabel && baseLabel !== media[0] && tracks.some((t) => !t.media)) {
      for (const t of tracks) { if (t.media) break; t.media = baseLabel; }
      media = [...new Set(tracks.map((t) => t.media).filter(Boolean))];
    }
    if (media.length >= 2) {
      // tracce senza prefisso: stesso supporto della traccia precedente
      let cur = media[0];
      tracks.forEach((t) => { if (t.media) cur = t.media; else t.media = cur; });
      const discsOf = {};
      tracks.forEach((t) => { (discsOf[t.media] = discsOf[t.media] || new Set()).add(t.disc || 1); });
      const units = [];
      tracks.forEach((t) => { t.unit = t.media + '#' + (t.disc || 1); if (!units.includes(t.unit)) units.push(t.unit); });
      const out = [];
      let curUnit = null, trailingHeads = 0;
      rows.forEach((r) => {
        if (r.header) {
          if (r.mediaHeading) return; // 'DVD "Concerto…"': sostituita dalla riga "DVD"
          out.push(r); trailingHeads++; return;
        }
        if (r.unit !== curUnit) {
          curUnit = r.unit;
          const label = r.media + (discsOf[r.media].size > 1 ? ' ' + (r.disc || 1) : '');
          out.splice(out.length - trailingHeads, 0, { pos: '', title: label, dur: '', header: true, mediaRow: true });
        }
        r.pos = (units.indexOf(r.unit) + 1) + '.' + r.pos;
        out.push(r); trailingHeads = 0;
      });
      return out;
    }
    const discs = new Set(tracks.filter((t) => t.disc).map((t) => t.disc));
    tracks.forEach((t) => { if (t.disc && discs.size > 1) t.pos = t.disc + '.' + t.pos; });
    return rows;
  }

  // Attributi di performance: restituisce { attrs: [[id, nome, motivo]], additional, warn }
  function perfAttrs(T, type) {
    const tracks = T.tracks.filter((t) => !t.header);
    const n = tracks.length;
    const title = D.title || '';
    const styles = (D.styles || []).concat(D.genres || []).map((s) => s.toLowerCase());
    const desc = mainDesc();
    const notes = D.notes || '';
    const out = [], warn = [];
    let liveHint = '';
    const share = (re) => (n ? tracks.filter((t) => re.test(t.title)).length / n : 0);
    const pct = (x) => Math.round(x * 100) + '% tracce';
    const focal = n ? tracks[0].title : ''; // singoli: conta il brano principale (il primo)
    const isSingle = type === 'i';

    // Contenuti "Additional release"
    const shares = ADDITIONAL.map(([re, id, name]) => [id, name, isSingle ? (re.test(focal) ? 1 : 0) : share(re)]);
    if (/\binstrumentals\b/i.test(title)) shares.find((s) => s[0] === 127)[2] = 1;      // "The Instrumentals"
    if (styles.includes('interview')) shares.find((s) => s[0] === 14)[2] = 1;
    if (desc.includes('Sampler') && !D.various) shares.push([132, 'Sampler', 1]);    // non per i sampler V/A di etichetta
    // demo promozionale (es. demo metal su cassetta/CD-R): "Demo" nel testo del formato o nel titolo
    const promoDemo = (D.formatTexts || []).some((x) => /^\s*(demo|promo(tional)? demo)\s*$/i.test(x)) ||
      /(^|[\s(\[:-])(demo( tape| cassette| cd-?r?)?|rehearsal( tape)?|promo tape)(\s+'?((19|20)\d\d|\d\d))?\s*[)\]]?\s*$/i.test(title);
    if (promoDemo) shares.push([18, 'Promotional demo', 1]);
    const union = isSingle ? (shares.some((s) => s[2] > 0) ? 1 : 0)
      : (n ? tracks.filter((t) => ADDITIONAL.some(([re]) => re.test(t.title))).length / n : 0);
    let addl = shares.filter((s) => s[2] > 0.5);
    if (!addl.length && union > 0.5) addl = shares.filter((s) => s[2] >= 0.2);
    addl.forEach(([id, name, sh]) => out.push([id, name, sh >= 1 ? 'intera release' : pct(sh)]));

    // Live (o Live sessions se già rilevate sopra)
    const liveShare = isSingle ? (PERF.live.test(focal) ? 1 : 0) : share(PERF.live);
    const liveTitle = /\blive (at|in|from|on)\b|\(live\b|\[live\b/i.test(title);
    const liveNotes = /recorded live\b|live recording/i.test(notes) && !/live (in|at) (the )?studio|live in studio/i.test(notes);
    // Live solo con più del 50% delle tracce; titolo o note da soli = da verificare (wiki "Release attributes" §1.2.1)
    if (!out.some((a) => a[0] === 131) && liveShare <= 0.5 && (liveTitle || liveNotes)) liveHint = liveTitle ? say('titolo', 'title') : say('note della release', 'release notes');
    if (!out.some((a) => a[0] === 131) && liveShare > 0.5) {
      out.push([5, 'Live', pct(liveShare)]);
      warn.push('Live: per Rym solo se registrato davanti a un pubblico vero; le sessioni in studio/radio vanno in "Live sessions".');
    }

    // Remixes: singoli -> solo se il brano principale è un remix
    const remixShare = isSingle ? (PERF.remix.test(focal) ? 1 : 0) : share(PERF.remix);
    if (remixShare > 0.5) out.push([24, 'Remixes', isSingle ? 'brano principale remix' : pct(remixShare)]);

    // Selector Comp: compilation V/A non mixata, con un compilatore accreditato
    if (D.various && D.compiledBy && !desc.includes('Mixed')) {
      out.push([10, 'Selector Comp', 'compilatore accreditato']);
      warn.push('Selector Comp: aggiungi il compilatore nei crediti (ruolo "compiler").');
    }

    // Archival: registrato almeno 10 anni prima dell'uscita (anno nelle note: "Recorded ... 1972")
    const recYears = [...notes.matchAll(/recorded[^.\n]{0,80}?\b(19\d\d|20\d\d)\b/gi)].map((m) => +m[1]);
    const reissue = desc.includes('Reissue') || desc.includes('Repress') || /originally released/i.test(notes); // ristampa: non è archival
    if (recYears.length && D.year && !reissue && !['c', 'b'].includes(type)) {
      const rec = Math.min(...recYears);
      if (+D.year - rec >= 10) out.push([7, 'Archival', 'registrato nel ' + rec + ', uscito nel ' + D.year]);
    }

    // Creative Commons
    if (D.cc || /creative\s*commons|creativecommons\.org|\bcc[\s-]by\b/i.test(notes)) out.push([78, 'Creative Commons', 'licenza indicata']);

    // Colonne sonore (stili Discogs / tag Bandcamp)
    const st = (s) => styles.some((x) => x === s || (s.length > 4 && x.includes(s))); // "ost" solo esatto (non "post-punk")
    const text = (title + ' ' + notes).toLowerCase();
    if (st('score') || st('film score')) out.push([53, 'Film Score', 'stile "Score"']);
    else if (st('soundtrack') || st('ost') || st('video game music') || st('vgm')) {
      if (st('video game') || st('vgm') || /video\s*game|game soundtrack/.test(text)) out.push([56, 'Video Game Soundtrack', 'colonna sonora di videogioco']);
      else if (/\b(tv|television|series)\b/.test(text)) out.push([55, 'Television Soundtrack', 'colonna sonora TV']);
      else out.push([54, 'Motion Picture Soundtrack', 'stile "Soundtrack"']);
    }
    if (st('musical')) out.push([57, 'Cast Recording', 'stile "Musical"']);
    if (out.some((a) => [53, 54, 55, 56, 57].includes(a[0]))) warn.push('Colonna sonora: verifica il tipo (film, TV, videogioco, cast) e il "file under" (compositori o V/A).');

    // "Songs inspired by...": musica scritta dopo il film
    if (/songs?\s+(from\s+and\s+)?inspired\s+by|music\s+(from\s+and\s+)?inspired\s+by/i.test(text)) out.push([69, 'Songs "Inspired By..."', say('titolo/note', 'title/notes')]);
    // AI-generated: solo se dichiarato esplicitamente (wiki "AI-generated music")
    if (/\bai[- ]generated\b|\bgenerated (with|by|using) (ai|suno|udio)\b|\bmade (with|using) (suno|udio)\b|\b(suno|udio)\s+(ai|v?\d)/i.test(notes)) {
      out.push([133, 'AI-generated', say('dichiarato nelle note', 'stated in the notes')]);
      warn.push(say('AI-generated: la wiki richiede prove precise (dichiarazione, etichetta della piattaforma o rilevatore ≥93%). Verifica prima di inviare.',
        'AI-generated: the wiki asks for clear evidence (statement, platform label or a detector at 93% or higher). Check it before submitting.'));
    }
    if (promoDemo) warn.push(say('Promotional demo: è una demo preparata per cercare un contratto (o una demo metal). Se sono demo uscite dopo l\'album, usa "Demo recordings".',
      'Promotional demo: a demo made to get a record deal (or a metal demo). If they are demos released after the album, use "Demo recordings".'));

    const additional = addl.length > 0;
    if (additional) warn.push('Contenuti da "Additional release" (' + addl.map((a) => a[1]).join(', ') + '): per Rym va in quella sezione. Verifica.');
    if (out.length && (desc.includes('Reissue') || desc.includes('Repress'))) warn.push('Gli attributi di performance si impostano solo sulla primary issue.');
    return { attrs: out, additional, warn, liveHint };
  }

  // Modalità di capitalizzazione per la release corrente (stato della spunta)
  // Lingua della release: voto a maggioranza dei titoli riconoscibili (inglese contro non inglese);
  // con meno di 3 voti o in parità decide l'insieme delle parole.
  function releaseLang() {
    const titles = [D.title].concat((D.tracks || []).map((t) => t.title)).filter(Boolean);
    const votes = {};
    titles.forEach((t) => { const l = detectLang(t, true); if (l !== 'unknown') votes[l] = (votes[l] || 0) + 1; });
    const en = votes.en || 0;
    const nonEn = Object.keys(votes).filter((k) => k !== 'en');
    const nonEnTotal = nonEn.reduce((a, k) => a + votes[k], 0);
    if (en + nonEnTotal < 3) return detectLang(titles.join(' ')); // troppo pochi voti
    if (en > nonEnTotal) return 'en';
    if (nonEnTotal > en) {
      const named = nonEn.filter((k) => k !== 'xx').sort((a, b) => votes[b] - votes[a]);
      return named.length ? named[0] : 'xx';
    }
    return detectLang(titles.join(' '));
  }

  function capsState() {
    const lang = releaseLang();
    if (keepCaps) return { english: capsMode !== false, auto: false, lang, hold: 'keep' };
    if (capsMode !== null) return { english: capsMode, auto: false, lang, hold: null };
    if (D.classical) return { english: false, auto: true, lang, hold: 'classical' };
    return { english: lang === 'en' || lang === 'unknown', auto: true, lang, hold: null };
  }
  // Modalità per un singolo titolo: 'en' (inglese), 'sent' (solo iniziale), 'keep' (non toccare).
  // In automatico decide titolo per titolo (dischi con brani in più lingue); senza indizi vale la lingua della release.
  function capsModeFor(str, C) {
    const scr = scriptOf(str || '');
    if (scr === 'zz') return { m: 'keep' };
    if (scr === 'ru') return { m: 'sent', lang: 'ru' };
    if (!C.auto) return C.english ? { m: 'en' } : { m: 'sent', lang: C.lang };
    let lt = detectLang(str, true);
    if (lt === 'unknown') lt = C.lang;
    // indizio debole "inglese" in un disco turco/indonesiano/filippino: vale la lingua del disco
    if (lt === 'en' && TITLE_LANGS[C.lang] && detectLangStrong(str) === 'unknown') lt = C.lang;
    // titolo "non inglese" senza lingua precisa: vale la lingua del disco (francese, olandese…)
    if (lt === 'xx' && C.lang && !['en', 'unknown', 'xx'].includes(C.lang)) lt = C.lang;
    if (TITLE_LANGS[lt]) return { m: 'title', lang: lt };
    if (lt === 'de' || lt === 'zz') return { m: 'keep' }; // tedesco: i sostantivi vanno maiuscoli
    return lt === 'en' || lt === 'unknown' ? { m: 'en' } : { m: 'sent', lang: lt };
  }

  // Vinili: Rym vuole il minutaggio solo se è stampato sul disco/copertina. Lo decide chi carica con la spunta
  // "Importa minutaggio" (di base tolta), visibile solo per i vinili.
  const isVinyl = () => /^(vinyl|lathe cut|flexi-disc|shellac|acetate)$/i.test(D.formatName || '');
  // le note Discogs dicono che le durate non sono stampate (o sono state misurate)
  const NOT_PRINTED = /(track\s*)?(durations?|timings?|times|running\s+times?|lengths?)\s+(are\s+|were\s+)?not\s+(printed|listed|stated|given|shown|indicated)|(durations?|timings?|times)\s+(were\s+|are\s+)?(taken|timed|measured|calculated)\s+(from|with|by|on)/i;
  const durNotPrinted = () => NOT_PRINTED.test(D.notes || '');

  // Testo secondo la wiki "Text formatting"
  function normText(s0) {
    let x = String(s0 || '');
    x = x.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '');                                   // zero-width
    x = x.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' '); // full-width
    x = x.replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => c.normalize('NFKC'));                          // 𝐁𝐨𝐥𝐝 → Bold
    x = x.replace(/(\p{L})(\p{M}{3,})/gu, (all, l, marks) => l + marks.slice(0, 1));                // zalgo
    x = x.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"');
    x = x.replace(/\s[–—]\s/g, ' - ').replace(/[–—]/g, '-');
    x = x.replace(/\{([^}]*)\}/g, '($1)').replace(/[<⟨〈]([^>⟩〉]*)[>⟩〉]/g, '($1)');
    // le quadre restano solo per il testo editoriale in minuscolo ("[bonus track]", "[untitled]")
    x = x.replace(/\[([^\]]*)\]/g, (all, inner) => (/^[a-z0-9 .,'#&-]+$/.test(inner) && /[a-z]/.test(inner) ? all : '(' + inner + ')'));
    x = x.replace(/\|/g, '/');
    return x.replace(/\s{2,}/g, ' ').trim();
  }

  // Come archiviare la release (wiki "Add a release"): V/A con 5+ artisti, split con 2-4 (file under a ciascuno),
  // collaborazione per "A & B"; "feat."/"with" nell'artista della release = crediti, non file under
  function releaseMode() {
    const list = (D.artistsList || []).length ? D.artistsList : (D.artist ? [{ name: D.artistSearch || D.artist, anv: '', join: '' }] : []);
    const fileUnder = [], featured = [], guests = [];
    let joinKind = null, role = 'main';
    list.forEach((a, i) => {
      if (!(a.various || isVarious(a.name))) {
        if (role === 'feat') featured.push(a.name); else if (role === 'with') guests.push(a.name); else fileUnder.push(a.name);
      }
      const j = (a.join || '').toLowerCase().trim();
      if (!j || i === list.length - 1) return;
      if (/^(feat\.?|featuring|ft\.?)$/.test(j)) role = 'feat';
      else if (j === 'with') role = 'with';
      else if (role === 'main') {
        if (/^(\/|,|split|-)$/.test(j)) joinKind = 'split';
        else joinKind = joinKind || 'collab';
      }
    });
    const distinct = [];
    (D.tracks || []).filter((t) => !t.header).forEach((t) => {
      const names = (t.artists || []).length ? t.artists : (t.artist && !isVarious(t.artist) ? [t.artist] : []);
      names.forEach((n) => { if (n && !isVarious(n) && !distinct.some((x) => norm(x) === norm(n))) distinct.push(n); });
    });
    let mode = 'single';
    if (D.classical) mode = 'classical';
    else if (D.various) mode = distinct.length >= 5 || distinct.length < 2 ? 'va' : 'split';
    else if (fileUnder.length >= 2) mode = joinKind === 'split' ? 'split' : 'collab';
    return { mode, fileUnder: mode === 'split' && D.various ? distinct : fileUnder, featured, guests, distinct, joinKind };
  }

  // Titolo e tracce pronti per Rym. Le righe senza numero (suite, opere, sezioni, "CD"/"DVD")
  // vanno in grassetto: [b]Titolo[/b].
  function prepare() {
    const res = prepareTexts();
    // tracce senza titolo: "[untitled]" (wiki Rym, "Add release information" §17.1), dopo le maiuscole
    let untitled = 0;
    res.tracks.forEach((t) => {
      if (!t.header && /^[\[(]?\s*untitled\s*[\])]?$/i.test((t.title || '').trim())) { t.title = '[untitled]'; untitled++; }
    });
    if (untitled) res.log.push('Tracce senza titolo scritte come "[untitled]": ' + untitled);
    // Various Artists: "Artista - Titolo" (trattino breve con spazi), dopo le maiuscole così il nome resta com'è
    // anche negli split (2-4 artisti) ogni traccia va scritta "Artista - Titolo" (wiki "Add a release" §4)
    const RM = releaseMode();
    if (RM.mode === 'va' || RM.mode === 'split') {
      let withArtist = 0;
      res.tracks.forEach((t) => {
        if (t.header || !t.artist || isVarious(t.artist)) return;
        if (t.title.toLowerCase().startsWith(t.artist.toLowerCase() + ' - ')) return;
        t.plain = t.title; // titolo senza artista: serve per il titolo proposto dei singoli
        t.title = t.artist + ' - ' + t.title; withArtist++;
      });
      if (withArtist) res.log.push('V/A: nome dell\'artista davanti al titolo in ' + withArtist + ' tracce');
    }
    res.tracks.forEach((t) => {
      if (t.header && t.title && !/^\[b\][\s\S]*\[\/b\]$/i.test(t.title)) t.title = '[b]' + t.title + '[/b]';
    });
    return res;
  }

  // Titolo e tracce con posizioni Rym e maiuscole corrette
  function prepareTexts() {
    const tracks = (D.tracks || []).map((t) => Object.assign({}, t));
    const res = { title: D.title || '', tracks, log: [], warn: [], titleEn: '', featured: [], guests: [] };
    tracks.forEach((t) => { t.orig = t.pos; });
    // testo: apostrofi e virgolette dritti, trattini semplici, parentesi tonde, niente caratteri invisibili (wiki "Text formatting")
    let fixedText = 0;
    const nt = (x) => { const y = normText(x); if (y !== x) fixedText++; return y; };
    res.title = nt(res.title);
    tracks.forEach((t) => { t.title = nt(t.title); });
    if (fixedText) res.log.push(say('Caratteri sistemati (apostrofi, virgolette, trattini, parentesi): ', 'Characters fixed (apostrophes, quotes, dashes, brackets): ') + fixedText + say(' titoli', ' titles'));
    // traduzioni di Discogs separate da " = "
    const hasNonLatin = (x) => /(?!\p{Script=Latin})\p{L}/u.test(x);
    if (/\s=\s/.test(res.title)) {
      const [a, ...rest] = res.title.split(/\s+=\s+/);
      const b = rest.join(' = ');
      if (hasNonLatin(a) && !hasNonLatin(b)) {
        res.title = a; res.titleEn = capEN(b, [D.artist, D.artistSearch]).text;
        res.log.push(say('Titolo localizzato in inglese preso dalla traduzione Discogs: «', 'Localized English title taken from the Discogs translation: «') + b + '»');
      } else {
        res.warn.push(say('Il titolo ha due lingue unite da " = ": su Rym va nella scrittura principale della release, l\'eventuale traduzione inglese nel campo localizzato.',
          'The title has two languages joined by " = ": on Rym it goes in the main script of the release, any English translation in the localized field.'));
      }
    } else if (hasNonLatin(res.title)) {
      res.warn.push(say('Titolo in scrittura non latina: nel campo "localized to English" metti la traduzione ufficiale o una traslitterazione standard (mai una traduzione automatica).',
        'Title in a non-Latin script: in the "localized to English" field enter the official translation or a standard transliteration (never a machine translation).'));
    }
    let transl = 0;
    tracks.forEach((t) => {
      if (t.header || !/\s=\s/.test(t.title)) return;
      const [a, ...rest] = t.title.split(/\s+=\s+/);
      t.title = a + ' (' + rest.join(' / ') + ')'; transl++;
    });
    if (transl) res.log.push(say('Traduzioni nelle tracce messe tra parentesi: ', 'Translations in tracks put in brackets: ') + transl);
    // sottotitoli generici delle colonne sonore: ridondanti con gli attributi, vanno tolti (wiki, 2021)
    const GENERIC_ST = /\s*(?:[(\[]\s*|[:\-–]\s+)(?:(?:the\s+)?original\s+)?(?:(?:music|songs?)\s+(?:from\s+)?(?:and\s+inspired\s+by\s+)?(?:the\s+)?(?:original\s+)?(?:motion\s+picture|film|movie|netflix\s+(?:film|series)|(?:television|tv)(?:\s+series)?|series|video\s*game|game|musical)(?:\s+soundtrack)?|(?:(?:motion\s+picture|film|movie|television|tv|series|video\s*game|game|(?:original\s+)?(?:broadway\s+)?cast)\s+)?(?:soundtrack|score|cast\s+recording)(?:\s+(?:album|recording))?)\s*[)\]]?\s*$/i;
    if (GENERIC_ST.test(res.title)) {
      const cut = res.title.replace(GENERIC_ST, '').trim();
      if (cut) { res.log.push(say('Tolto il sottotitolo generico da colonna sonora: «', 'Generic soundtrack subtitle removed: «') + res.title + '» → «' + cut + '»'); res.title = cut; }
    }
    // "A b/w B" -> "A / B" (wiki "Release types" §4.1)
    if (/\s(?:b\/w|c\/w)\s/i.test(res.title)) { res.title = res.title.replace(/\s+(?:b\/w|c\/w)\s+/gi, ' / '); res.log.push('b/w → " / "'); }
    // Rym non vuole "(Original Mix)", "(Original)", "(Original Version)" nei titoli
    const ORIGINAL = /\s*(?:[(\[]\s*original(?:\s+(?:mix|version))?\s*[)\]]|\s[-–]\s*original(?:\s+(?:mix|version))?)\s*$/i;
    let origCut = 0;
    tracks.forEach((t) => { if (!t.header && ORIGINAL.test(t.title)) { t.title = t.title.replace(ORIGINAL, ''); origCut++; } });
    if (ORIGINAL.test(res.title)) res.title = res.title.replace(ORIGINAL, '');
    if (origCut) res.log.push('Tolto "(Original Mix)" / "(Original)" da ' + origCut + ' tracce');
    res.tracks = normPositions(tracks);
    if (tracks.some((t) => /^([A-Z])(?!\1)[A-Z]\d/.test((t.orig || '').trim()))) res.log.push(say('Solchi paralleli (AA1, AB1…): posizioni lasciate come su Discogs', 'Parallel grooves (AA1, AB1…): positions left as on Discogs'));
    // righe senza audio ("(no audio)", "(silence)"): Rym non le elenca
    const noAudio = res.tracks.filter((t) => !t.header && /^[(\[]?\s*(no audio|silence|silent track|blank)\s*[)\]]?$/i.test((t.title || '').trim()));
    if (noAudio.length) {
      res.tracks = res.tracks.filter((t) => !noAudio.includes(t));
      res.log.push(say('Tolte le righe senza audio: ', 'Rows without audio removed: ') + noAudio.map((t) => t.orig).join(', '));
    }
    // bonus digitali (codice download): intestazione "Digital Bonus Track(s)" e numerazione dedicata (wiki "Release attributes" §2.1)
    const dIdx = res.tracks.findIndex((t) => t.header && /(digital|download|mp3|file)/i.test(t.title) && /bonus/i.test(t.title));
    if (dIdx >= 0) {
      const digital = [];
      for (let i = dIdx + 1; i < res.tracks.length && !res.tracks[i].header; i++) digital.push(res.tracks[i]);
      const others = res.tracks.filter((t) => !t.header && !digital.includes(t));
      if (digital.length) {
        res.tracks[dIdx].title = digital.length === 1 ? 'Digital Bonus Track' : 'Digital Bonus Tracks';
        if (others.some((t) => /^[A-Z]/.test(t.pos))) digital.forEach((t, k) => { t.pos = String(k + 1); });
        else {
          const multi = others.some((t) => /^\d+\./.test(t.pos));
          if (!multi) others.forEach((t) => { t.pos = '1.' + t.pos; });
          const top = multi ? Math.max(...others.map((t) => parseInt(t.pos, 10) || 1)) : 1;
          digital.forEach((t, k) => { t.pos = (top + 1) + '.' + (k + 1); });
        }
        res.log.push(say('Bonus digitali: intestazione "', 'Digital bonus: header "') + res.tracks[dIdx].title + say('" e numerazione separata', '" and separate numbering'));
        res.warn.push(say('Bonus digitali: la wiki si contraddice (2018: non elencarli; pagina attributi: solo i brani in più, sotto "Digital Bonus Tracks"). Se i brani sono gli stessi del disco, toglili.',
          'Digital bonus: the wiki contradicts itself (2018: do not list them; attributes page: only the extra songs, under "Digital Bonus Tracks"). If they are the same songs as the record, remove them.'));
      }
    }
    // "feat."/"with" nei titoli: per Rym vanno nei crediti, non nel titolo (il nome del remix invece resta)
    const FEAT_BR = /\s*[(\[]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]+?)\s*[)\]]/gi;
    const WITH_BR = /\s*[(\[]\s*with\s+([^)\]]+?)\s*[)\]]/gi;
    const FEAT_END = /\s+(?:feat\.|ft\.|featuring)\s+(.+)$/i;
    const takeFeat = (title, pos) => {
      let x = title.replace(FEAT_BR, (all, who) => { res.featured.push({ who: who.trim(), pos }); return ''; });
      x = x.replace(WITH_BR, (all, who) => { res.guests.push({ who: who.trim(), pos }); return ''; });
      const m = x.match(FEAT_END);
      if (m) { res.featured.push({ who: m[1].trim(), pos }); x = x.slice(0, m.index); }
      return x.replace(/\s{2,}/g, ' ').trim();
    };
    res.title = takeFeat(res.title, '');
    res.tracks.forEach((t) => { if (!t.header) t.title = takeFeat(t.title, t.pos); });
    if (res.featured.length || res.guests.length) {
      res.log.push(say('Tolti dai titoli: ', 'Removed from titles: ') + res.featured.map((f) => 'feat. ' + f.who).concat(res.guests.map((g) => 'with ' + g.who)).join(', '));
    }
    const changed = res.tracks.find((t) => !t.header && t.pos !== t.orig);
    if (changed) res.log.push('Posizioni tracce adattate a Rym (es. "' + changed.orig + '" → "' + changed.pos + '")');
    if (isVinyl() && (!durVinyl || durNotPrinted()) && res.tracks.some((t) => t.dur)) {
      res.tracks.forEach((t) => { t.dur = ''; });
      if (durNotPrinted()) res.log.push(say('Le note Discogs dicono che le durate non sono stampate sul disco', 'The Discogs notes say the durations are not printed on the record'));
      res.log.push('Vinile: minutaggio non importato (spunta "Importa minutaggio" tolta)');
    }
    const mediaRows = res.tracks.filter((t) => t.mediaRow).map((t) => t.title);
    if (mediaRows.length) res.log.push('Righe dei supporti (senza numero): ' + mediaRows.join(', '));
    const C = capsState();
    const protect = [D.artist, D.artistSearch].filter(Boolean);
    const rows = res.tracks.filter((t) => !t.mediaRow); // le righe "CD"/"DVD" restano così
    if (C.hold === 'keep') {
      res.log.push(say('Maiuscole lasciate come sulla fonte', 'Capitalization left as on the source'));
      res.warn.push(say('Maiuscole come sulla fonte: vale solo per le eccezioni ammesse dalla wiki (grafia ufficiale confermata da fonti concordi). Spiega il motivo nelle fonti; una tracklist tutta maiuscola o tutta minuscola va comunque normalizzata.',
        'Capitalization as on the source: only for the exceptions allowed by the wiki (official styling confirmed by consistent sources). Explain why in the sources; a tracklist all in capitals or all in lowercase must be normalized anyway.'));
      return res;
    }
    if (C.hold) {
      res.warn.push('Classica: maiuscole lasciate come su Discogs (le opere seguono regole proprie). Controllale, oppure scegli la modalità con la spunta.');
      return res;
    }
    const before = res.title;
    const flags = new Set();
    const count = { en: 0, sent: 0, keep: 0, title: 0 };
    const langsSeen = new Set();
    const fix = (str) => {
      const md = capsModeFor(str, C);
      let out = str;
      if (md.m === 'en') { const r = capEN(str, protect); r.flags.forEach((f) => flags.add(f)); out = r.text; }
      else if (md.m === 'title') { out = capEN(str, protect, md.lang).text; langsSeen.add(md.lang); }
      else if (md.m === 'sent') { out = capSentence(str, protect, md.lang); if (md.lang) langsSeen.add(md.lang); }
      if (out !== str) count[md.m]++;
      if (md.m === 'keep' && str) count.keep++;
      // traduzione latina tra parentesi in un titolo non latino: maiuscole inglesi
      if (scriptOf(str)) out = out.replace(/\(([^()]*)\)/g, (all, inner) => (!hasNonLatin(inner) && /\p{L}/u.test(inner) ? '(' + capEN(inner, protect).text + ')' : all));
      return out;
    };
    res.title = fix(res.title);
    rows.forEach((t) => { t.title = fix(t.title); });
    if (count.en) res.log.push('Capitalizzazione inglese Rym: ' + count.en + ' titoli');
    if (count.sent) res.log.push('Solo iniziale maiuscola (titoli non inglesi): ' + count.sent + ' titoli');
    if (count.title) res.log.push(say('Maiuscole secondo le regole di ', 'Capitalization following the rules for ') + [...langsSeen].filter((l) => TITLE_LANGS[l]).map((l) => LANG_NAME[l]).join(', ') + ': ' + count.title + say(' titoli', ' titles'));
    if (langsSeen.has('fr')) res.warn.push(say('Francese: dopo " : ", " ! ", " ? " con lo spazio si continua in minuscolo (non vale in Canada, tranne i due punti).', 'French: after " : ", " ! ", " ? " with a space the text goes on in lowercase (not in Canada, except the colon).'));
    if (res.title !== before) res.log.push('Titolo: «' + before + '» → «' + res.title + '»');
    if (C.auto && C.lang !== 'unknown') res.log.push('Lingua stimata: ' + LANG_NAME[C.lang] + ' (cambia la modalità con la spunta)');
    if (flags.size) {
      res.warn.push('Maiuscole: controlla ' + [...flags].map((f) => '«' + f + '»').join(', ') +
        ': minuscolo se preposizione o congiunzione, maiuscolo se avverbio (es. "Keep On Rockin\'", "You Are So Beautiful").');
    }
    if (count.sent || (!C.auto && !C.english)) res.warn.push('Titoli non inglesi: controlla nomi propri, luoghi e nomi di gruppi, che vanno in maiuscolo (es. "Il meglio di Elio e le Storie Tese").');
    if (count.keep) res.warn.push('Titoli in tedesco o in scritture non latine lasciati come su Discogs (in tedesco i sostantivi vanno maiuscoli): controllali a mano.');
    return res;
  }

  // ---- helpers DOM ----
  function clearVal(el) {
    if (!el || el.value === '') return;
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setVal(el, v) {
    if (!el || v === '' || v == null) return false;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function setSelect(id, v) {
    const el = document.getElementById(id);
    if (!el || !v || !el.querySelector('option[value="' + v + '"]')) return false;
    return setVal(el, v);
  }
  function clickRadio(name, value) {
    const el = form.querySelector('input[type=radio][name="' + name + '"][value="' + value + '"]');
    if (!el) return false;
    if (!el.checked) el.click();
    return true;
  }
  function check(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    if (!el.checked) { el.click(); touched.attribs.add(id); }
    return true;
  }
  const radioVal = (name) => (form.querySelector('input[type=radio][name="' + name + '"]:checked') || {}).value;
  // stato iniziale dei pulsanti radio, per poterlo ripristinare
  const INITIAL = {};
  ['category', 'type', 'format', 'disc_size', 'collab_type', 'credited_name'].forEach((n) => { INITIAL[n] = radioVal(n); });

  // Annulla quello che lo script aveva compilato (prima di compilare un'altra release)
  function resetForm() {
    touched.attribs.forEach((id) => { const el = document.getElementById(id); if (el && el.checked) el.click(); });
    touched.attribs.clear();
    Object.keys(INITIAL).forEach((n) => { if (INITIAL[n] != null) clickRadio(n, INITIAL[n]); });
    ['year', 'month', 'day'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.selectedIndex !== 0) { el.selectedIndex = 0; el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    ['title', 'catalog_no', 'countries'].forEach((id) => clearVal(document.getElementById(id)));
    const notes = $('#notes');
    if (notes && touched.notesUrl) {
      notes.value = notes.value.replace(touched.notesUrl, '').replace(/\n{2,}/g, '\n').trim();
      touched.notesUrl = '';
    }
    ['title_en', 'addendum', 'languages', 'va_labels'].forEach((id) => { if (touched.fields.has(id)) clearVal(document.getElementById(id)); });
    if (touched.fields.has('rec')) ['rec_from_year', 'rec_from_month', 'rec_from_day', 'rec_to_year', 'rec_to_month', 'rec_to_day'].forEach((id) => { const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
    if (touched.fields.has('credited')) ['credited_firstname', 'credited_lastname'].forEach((id) => clearVal(document.getElementById(id)));
    touched.fields.clear();
    touched.credits.forEach((n) => { try { W.deleteCredit(n); } catch (e) { /* - */ } });
    touched.credits = [];
    pendingLink = null;
    clearInterval(vaTimer);
    if (touched.tracks) {
      try { W.goAdvanced(); $('#track_advanced').value = ''; W.goSimple(); } catch (e) { /* ignora */ }
      touched.tracks = false;
    }
  }

  // Artisti già impostati nella pagina (1.3a) e confronto con l'artista della release
  const norm = (s) => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '');
  function pageArtists() {
    return [...document.querySelectorAll('[id^="filed_under_performer_artist_"][id$="_preview"] a')].map((a) => a.textContent.trim()).filter(Boolean);
  }
  function artistMismatch() {
    const names = pageArtists();
    if (!D || D.various || !names.length) return null;
    // per la classica valgono anche gli interpreti (Discogs mette spesso il compositore come artista)
    const want = [D.artistSearch, D.artist].concat((D.performers || []).map((p) => p.replace(/\s*\([^)]*\)$/, ''))).map(norm).filter(Boolean);
    const ok = names.some((n) => want.some((w) => norm(n).includes(w) || w.includes(norm(n))));
    return ok ? null : names.join(', ');
  }

  // ---- aiuti per la compilazione (file under, etichetta, crediti, date, lingue, fonti) ----
  function searchPerformer(who) {
    setVal($('#filed_under_searchterm'), who);
    const fr = $('#filed_underperformerlist'); // stessa URL di searchfiled_under() di Rym / same URL as Rym's searchfiled_under()
    if (fr) fr.src = '/go/searchcredits?target=filedunderperformer&label=performer&searchterm=' + encodeURIComponent(who);
  }
  function searchComposer(who) {
    setVal($('#filed_under_composer_searchterm'), who);
    const fr = $('#filed_undercomposerlist');
    if (fr) fr.src = '/go/searchcredits?target=filedundercomposer&label=composer&searchterm=' + encodeURIComponent(who);
  }

  // nome accreditato come sulla release: "featuring"/"with" in minuscolo (wiki §3)
  function creditedString() {
    const list = D.artistsList || [];
    if (!list.length) return D.artist;
    let out = '';
    list.forEach((a, i) => {
      out += a.anv || a.name;
      if (i === list.length - 1) return;
      const j = (a.join || '').trim();
      if (/^(feat\.?|featuring|ft\.?)$/i.test(j)) out += ' featuring ';
      else if (/^with$/i.test(j)) out += ' with ';
      else if (j === ',') out += ', ';
      else out += j ? ' ' + j + ' ' : ' ';
    });
    return out.replace(/\s{2,}/g, ' ').trim();
  }
  function setCreditedName(str) {
    const radio = $('#credited_name_specified');
    if (!radio) return;
    if (!radio.checked) radio.click();
    const f = $('#credited_firstname'), l = $('#credited_lastname');
    [f, l].forEach((x) => { if (x) x.disabled = false; });
    // articolo iniziale nel campo First Name (wiki §3)
    const m = str.match(/^(the|a|an|le|la|les|il|lo|gli|el|los|las|die|der|das|de|het)\s+(.+)$/i);
    if (f) { f.value = m ? m[1] : ''; f.dispatchEvent(new Event('change', { bubbles: true })); }
    setVal(l, m ? m[2] : str);
    touched.fields.add('credited');
  }

  // Etichetta: Rym vuole la più specifica (principio LCD), Discogs mette per prima la più grande
  const BIG_GROUPS = /^(sony music( entertainment)?|sony bmg( music entertainment)?|universal music( group)?|universal|warner music( group)?|warner|emi( group| music)?|bmg( rights management)?)$/i;
  const DIGITAL_DISTRIB = /^(the orchard|believe( digital)?|tunecore|distrokid|cd ?baby|amuse|ditto( music)?|routenote|awal|ingrooves|onerpm|symphonic( distribution)?|level|soundrop|united masters|unitedmasters|empire|fuga|label ?worx|record union|spinnup|zimbalam|repost network)$/i;
  const DISTRIBUTORS = new Set(["!k7", "1 stop", "101 distribution", "3d system inc.", "3mv", "a&a music", "a&m distribution", "a-musik", "abc records group", "abeille musique", "above board distribution", "abraxas", "absolute distribution", "adda distribution", "albany music distributors", "album world", "alive", "allegro", "alliance entertainment", "allmusica", "almada corporation", "alphamagic", "alta record distributors", "altafonte music distribution", "alternative distribution alliance", "amato distribution", "amazing d.c.", "amg records", "amv", "amy mala bell records", "anticraft", "apt", "arabesque distribution", "aris", "art union corporation", "astral music", "atono", "audioglobe", "avex marketing inc.", "baked goods distribution", "bayside entertainment distribution", "beatspace", "bellaphon", "bertus", "big daddy music distribution", "bigwax distribution", "bmg distribution", "bonnier amigo music group", "boomkat", "border music distribution", "bottlenekk distribution", "boundee inc.", "bridge inc.", "brody distribution group", "broken silence", "burnside distribution", "cadiz music", "cameo parkway", "canadian music sales corp.", "caravan record sales", "cargo records", "carlton musikvertrieb", "caroline distribution", "carrere distribution", "carrot top distribution", "caytronics", "cema", "cfd", "challenge", "changing world distribution", "chat noir distribution", "city hall records", "clear spot international", "clone distribution", "cobraside distribution", "cod&s", "coda music", "codaex", "code 7", "cometomusic", "compagnie européenne du disque", "complete usa", "connected music vertrieb", "corona", "cosmophilia", "cosmos music group", "crosstalk", "crown tokuma", "cure", "da music", "daiki sound", "dame", "dbh music", "dbn", "deathwish direct", "decoder muzique", "deejay.de", "dell & stoffel", "delta music", "deltadischi", "demajors", "dep", "diamante music group", "diamond and pearls music", "diana charité", "differ-ant", "diger distro", "disco-deal", "discobel", "discobox", "discodis", "discograph", "discomagic", "discomania", "discord distribution", "disctrade", "disk union", "distribution fusion iii", "distribution pelléas", "distribution select", "distributions musitel", "distributionz", "distrijazz", "distrimusic", "distrisound", "dmr", "dms tonträger-vertriebs-gmbh", "dover records", "downstairs records", "ducale", "eams", "edel", "efa", "egea distribution", "electric distribution", "elektra distribution", "elite music", "emi music distribution", "eone distribution", "eos music", "essential music & marketing", "euromusica", "family affair distributions", "fast forward", "fat beats distribution", "festival distribution", "firestarter distribution", "fonior", "fonobrás", "fontana distribution", "fontana north distribution", "forced exposure", "forte distribution", "fuse music group", "fwd inc.", "galileo music communication", "gamut distribution", "genie music corporation", "gillmore music", "give five", "global net", "globe", "goldenrod music", "gonzo media group", "goodfellas", "goya music distribution", "groove attack", "groove distribution", "h'art musik-vertrieb", "happinet pm", "hard wax", "harmonia mundi", "hausmusik distribution", "hillcan sales enterprises", "hillside cd productions", "hitland distribution", "hoanzl", "holborne distributing", "hollandsche decca distributie", "hongly", "house arrest distribution", "house of kicks distribution", "i play vinyl", "i.l.s.", "ideal", "idn", "ids", "impetus distribution", "important record distributors, inc.", "ims", "in-akustik", "independent label distribution", "indi", "indigo", "indisc", "inelco", "inertia distribution", "infinity music distribution", "ingrooves", "integrale muzique limited", "intercord", "interdisc distribution", "intergroove", "international music distribution", "intertape", "intégral distribution", "ioda", "irascible distribution", "ird", "irda", "j-disc", "j/g", "japan music system", "jay-gee records", "jazz network", "jem records", "jes field", "jpt", "juno distribution", "jupiter distribuzione", "just'in distribution", "klm distribution", "knowledge alliance", "koch entertainment", "kompakt distribution", "konkurrent", "kudos", "l'autre distribution", "l.o.a.d media", "la baleine", "lab music", "landspeed records", "les allumés du jazz", "level-one distribution", "line music", "lobster distribution", "lumberjack mordam", "m-system", "m.d diffusion", "m.d.s.", "madrigal", "making waves", "mana initiative", "mandaï distribution", "marsal", "mca distributing corp.", "mcp sound & media", "mdi distribution", "mdm", "megaphon", "membran", "mercury inc.", "metrodisc", "metronome distribution", "mgm distribution", "microservice", "mid-town distribution", "mill city music", "mo's music machine", "modulor", "mosaic music distribution", "mti", "mushroom distribution services", "music & words", "music art emotions", "music distributor", "music mail", "musicast", "musicontact", "musicor", "musidisc", "musikkoperatørene", "musikvertrieb ag", "musimart", "musisoft", "mvh", "média 7", "mélodie distribution", "n.e.w.s.", "nail distribution", "navarre", "naxos", "naxos deutschland", "neuton", "new music distribution", "new note limited", "night & day", "nine mile", "nocturne", "non stop music", "northcountry distributors", "note 1", "nova", "nova tekk", "nrw distribution", "nsd", "ntt medien gmbh", "nu urban music", "nuclear blast", "nuplastix distribution", "omd", "ong distribution", "oomoxx media", "open music company", "orkhêstra international", "our distribution", "outside music", "oxymoron p&d incorporated", "p*dis", "p.j. imports", "parasol", "pci music", "peppermint jam distribution", "phd canada distributing", "philips phonografische industrie", "phon und ton", "phonag", "phonocolor", "pias", "pilz media group", "pingo distribution", "pinnacle", "plastic head music distribution", "plattlangarna", "playground music scandinavia", "plop distribution", "pmv (polygram musik vertrieb)", "poison city records", "pool music & media service", "popstock everlasting", "pp sales forces", "premiere music distributors", "prime direct distribution", "prime distribution", "proper music distribution", "proper sales & distribution", "psyshop", "pv (polygram vertrieb)", "pängg", "q-vertrieb", "qualiton imports ltd.", "rainbo records", "raleigh record sales", "ratspack records", "ready made", "record peddler", "red", "redeye distribution", "republic of music", "resolute distribution", "revdistribution", "revolver", "revolver usa", "rhythmethod", "rige", "right track", "riot! distributors", "river city music entertainment", "roblan distributors", "rock inc.", "rough trade arvato", "rough trade distribution", "rsk entertainment", "rtm (rough trade marketing)", "rue stendhal", "rumm", "rush hour distribution", "ryko distribution", "s.t. holdings", "safari ambiance", "sam-distribution", "sc distribution", "scp", "seikodo", "select", "select-o-hits", "selecta limited", "self distribuzione", "semaphore", "shellshock", "sidep", "silenzio", "slagerfabrikken", "socadisc", "sofrason", "sonet distribusjon", "sonic rendezvous", "sonodisc", "sonopress", "sonopresse", "sony music distribution", "soulfood", "sound base music", "sound idea distribution", "sound of nashville", "sound pollution distribution", "sounddesign austria", "sounds of music", "southern record distributors", "southern records", "southwest wholesale", "space shower networks inc.", "spartan records", "spv", "sri", "starday-king records", "stickfigure distribution", "stomp entertainment", "straight distribution", "street level llc", "studio distribution", "subterranean music distribution", "suburban distribution", "subwax distribution", "sunnymoon distribution", "sunshine record distributors", "syncrophone", "t.h.a. music distribution", "tcd records and tapes", "teldec telefunken-decca schallplatten gmbh", "tesco distribution", "the basar", "the business", "the cartel", "the compo company", "the entertainment network (ten)", "the orchard", "the planet company", "the pusher distribution", "the total record company", "the woods", "tim", "tommy boy distribution", "tonpool", "topplers", "topsound", "tower records", "town music", "tratore", "trc", "trend records & tapes", "triple vision record distribution", "tripsichord", "twilight", "two hands distribution", "töölön musiikkitukku", "ultra-vybe", "umg commercial services", "underclass", "underground music", "undertow recordings", "unearthed sounds", "uni distribution corp.", "unique", "universal music group distribution", "uvm distribution", "venus distribuzione", "venus records", "veto music wholesale", "videolar", "vinyl distribution", "vinyl france distribution", "vinyl-labor.com", "virgin music group", "virgin records america inc.", "vital distribution", "vivid sound", "voice music", "voices music & entertainment", "wagram music", "wakyo inc.", "warner-pioneer corporation", "waterslide records", "wea", "wea filipacchi music", "wirikuta distribution", "wmd", "woodstock", "wordandsound", "world international group inc.", "world serpent distribution", "zomba distribution"]);
  function pickLabel(labels) {
    const real = labels.filter((l) => l.name);
    const skipped = [];
    let lab = real[0];
    const weak = (l) => BIG_GROUPS.test(l.name) || DISTRIBUTORS.has(l.name.toLowerCase()) || DIGITAL_DISTRIB.test(l.name);
    if (real.length > 1 && lab && weak(lab)) {
      const better = real.find((l) => !weak(l) && !/^not on label/i.test(l.name));
      if (better) { real.slice(0, real.indexOf(better)).forEach((l) => skipped.push(l.name)); lab = better; }
    }
    return { lab, skipped, distributor: !!(lab && DIGITAL_DISTRIB.test(lab.name)) };
  }

  // cose che non sono numeri di catalogo (wiki "Catalog numbers" §8)
  function badCatno(c, labelName) {
    if (!c || c === 'n/a') return '';
    const x = c.trim();
    if (/^(B0|X0)[0-9A-Z]{8}$/.test(x)) return say('un ASIN di Amazon', 'an Amazon ASIN');
    if (/^(LC|EU\s*Label\s*Code)\s*-?\s*0*\d{4,6}$/i.test(x)) return say('un label code (LC)', 'a label code (LC)');
    if (/^DID[CPXYZ]\s*-?\s*\d+/i.test(x)) return say('un codice DID di Sony DADC', 'a Sony DADC DID code');
    if (/^(AAA|AAD|ADD|DDD|DAD)$/.test(x)) return say('un codice SPARS', 'a SPARS code');
    if (/^\d{12,13}$/.test(x)) return say('un codice a barre (UPC/EAN)', 'a barcode (UPC/EAN)');
    if (labelName && x.toLowerCase() === labelName.toLowerCase()) return say('il nome dell\'etichetta', 'the label name');
    return '';
  }

  // V/A: appena scegli l'etichetta a destra, il suo [LabelXXXX] va nel campo "Label(s)" dei classifier
  let vaTimer = null;
  function watchVaLabel() {
    clearInterval(vaTimer);
    const lab = $('#label'), va = $('#va_labels');
    if (!lab || !va) return;
    let done = false;
    vaTimer = setInterval(() => {
      if (done || !document.contains(va)) return clearInterval(vaTimer);
      const cat = (form.querySelector('input[name=category]:checked') || {}).value;
      if (cat === 'va' && lab.value && lab.value !== '0' && !va.value.trim()) {
        setVal(va, '[Label' + lab.value + ']'); touched.fields.add('va_labels'); done = true;
        toast(say('Classifier V/A: ', 'V/A classifier: ') + '[Label' + lab.value + ']');
      }
    }, 1000);
  }

  // variante di colore per il titolo: "[red marble vinyl]" in minuscolo (wiki §8.7)
  function colorBrag(fmt) {
    const vinyl = fmt === 95 || fmt === 96, tape = fmt === 66;
    if (!vinyl && !tape) return '';
    if (tape && !(D.descriptions || []).includes('Limited Edition')) return '';
    const texts = vinyl && (D.vinylTexts || []).length ? D.vinylTexts : (D.formatTexts || []);
    const NOT = tape ? /\b(labels?|insert|j-?card|sleeve|box|case|print(ed)?|booklet)\b/i : NOT_VINYL;
    const part = texts.join(',').split(/[,;+]|\bwith\b/i).map((p) => p.trim()).find((p) => COLOR_WORDS.test(p) && !NOT.test(p));
    if (!part) return '';
    const c = part.toLowerCase()
      .replace(/\b\d{1,2}\s*("|''|”|-?inch(es)?)/g, '').replace(/\b(limited|ltd|numbered)\b.*$/, '').replace(/\b\d{2,3}\s*-?\s*(g|gr|grams?)\b/g, '')
      .replace(/\s*\b(vinyl|cassette|tape|shell|lp|edition|pressing)\b\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
    return c ? '[' + c + (vinyl ? ' vinyl' : ' cassette') + ']' : '';
  }

  // Edition name: solo nomi veri ("30th Anniversary Edition"), non attributi ("Limited Edition")
  const BAD_EDITION = /^(limited|special|numbered|deluxe|super deluxe|standard|first|1st|reissue|re-issue|colou?red|vinyl|promo|digital|collector'?s|remastered|clean|explicit|censored)\s+edition$/i;
  function findEdition(title, texts) {
    const m = (title || '').match(/\s*(?:[(\[]\s*|[-–:]\s+)([^()\[\]:]*?\bedition)\s*[)\]]?\s*$/i);
    if (m && !BAD_EDITION.test(m[1].trim())) {
      const cutTitle = title.slice(0, m.index).trim();
      if (cutTitle) return { name: capEN(m[1].trim()).text, inTitle: true, cutTitle };
    }
    for (const t of texts) {
      const seg = t.split(/[,;|]/).map((x) => x.trim()).find((x) => /\bedition\b/i.test(x) && !BAD_EDITION.test(x) && x.split(/\s+/).length <= 6);
      if (seg) return { name: capEN(seg).text, inTitle: false };
    }
    return null;
  }

  // società dei diritti -> paese (wiki "Places issued" §4); le società "meccaniche" (BIEM, NCB, SDRM) non bastano
  const PRO = { SIAE: 'Italy', GEMA: 'Germany', SACEM: 'France', SGAE: 'Spain', SPA: 'Portugal', SABAM: 'Belgium', BUMA: 'Netherlands', STEMRA: 'Netherlands',
    MCPS: 'United Kingdom', PRS: 'United Kingdom', AKM: 'Austria', SUISA: 'Switzerland', STIM: 'Sweden', TONO: 'Norway', KODA: 'Denmark', TEOSTO: 'Finland',
    STEF: 'Iceland', IMRO: 'Ireland', ZAIKS: 'Poland', OSA: 'Czechia', SOZA: 'Slovakia', ARTISJUS: 'Hungary', UCMR: 'Romania', MUSICAUTOR: 'Bulgaria',
    HDS: 'Croatia', SOKOJ: 'Serbia', SAZAS: 'Slovenia', AEPI: 'Greece', MESAM: 'Turkey', MSG: 'Turkey', RAO: 'Russian Federation', UACRR: 'Ukraine',
    EAU: 'Estonia', AKKA: 'Latvia', LATGA: 'Lithuania', ACUM: 'Israel', JASRAC: 'Japan', KOMCA: 'South Korea', MUST: 'Taiwan', CASH: 'Hong Kong',
    MCSC: 'China', COMPASS: 'Singapore', MACP: 'Malaysia', FILSCAP: 'Philippines', IPRS: 'India', ASCAP: 'United States', BMI: 'United States',
    SESAC: 'United States', HFA: 'United States', AMRA: 'United States', SOCAN: 'Canada', CAPAC: 'Canada', PROCAN: 'Canada', SODRAC: 'Canada',
    CMRRA: 'Canada', APRA: 'Australia', AMCOS: 'Australia', SADAIC: 'Argentina', CAPIF: 'Argentina', ECAD: 'Brazil', ABRAMUS: 'Brazil', UBC: 'Brazil',
    SACM: 'Mexico', SCD: 'Chile', SAYCO: 'Colombia', APDAYC: 'Peru', AGADU: 'Uruguay', SACVEN: 'Venezuela', SAMRO: 'South Africa', SAYCE: 'Ecuador' };
  function countryFromSocieties(list) {
    const found = new Map();
    list.forEach((v) => String(v).toUpperCase().split(/[\s\/,;+&-]+/).forEach((tok) => { if (PRO[tok] && !found.has(PRO[tok])) found.set(PRO[tok], tok); }));
    return [...found].map(([country, society]) => ({ country, society }));
  }
  // "Milano, Italia" -> paese Rym (solo se riconosciuto)
  function countryFromLocation(loc) {
    const last = String(loc || '').split(',').pop().trim();
    if (!last) return '';
    const m = mapCountries(last);
    return m.unknown.length || m.skipped.length ? '' : m.value;
  }

  // confezioni citate solo nelle note Discogs (da confermare con un clic)
  const PACK_NOTES = [
    [/\bgatefold\b/i, 30, 'Gatefold', null],
    [/\bdigi-?pac?k\b/i, 21, 'Digipak', null],
    [/\b(card(board)?|paper)[\s-]?sleeve\b|\bcardsleeve\b|\bdigisleeve\b/i, 81, 'Paper/Cardboard Sleeve', OPTICAL],
    [/\bslip-?case\b|\bo-?card\b/i, 111, 'Slipcase / O-Card', null],
    [/\bdigibook\b/i, 109, 'Digibook', null],
    [/\bmini[\s-]?lp\b|\blp[\s-]?replica\b|\bpaper sleeve replica\b/i, 60, 'CD Sized Album Replica', OPTICAL],
    [/\bhand-?made\b|\bhand-?assembled\b/i, 33, 'Handmade', null]
  ];

  // Date di registrazione: frasi "Recorded…" delle note, oppure la data nel titolo di un live
  const MONTHS = { january: 1, jan: 1, gennaio: 1, janvier: 1, januar: 1, enero: 1, february: 2, feb: 2, febbraio: 2, 'février': 2, fevrier: 2, februar: 2, febrero: 2,
    march: 3, mar: 3, marzo: 3, mars: 3, 'märz': 3, april: 4, apr: 4, aprile: 4, avril: 4, abril: 4, may: 5, maggio: 5, mai: 5, mayo: 5,
    june: 6, jun: 6, giugno: 6, juin: 6, juni: 6, junio: 6, july: 7, jul: 7, luglio: 7, juillet: 7, juli: 7, julio: 7, august: 8, aug: 8, agosto: 8, 'août': 8, aout: 8,
    september: 9, sep: 9, sept: 9, settembre: 9, septembre: 9, septiembre: 9, october: 10, oct: 10, ottobre: 10, octobre: 10, oktober: 10, octubre: 10,
    november: 11, nov: 11, novembre: 11, noviembre: 11, december: 12, dec: 12, dicembre: 12, 'décembre': 12, decembre: 12, dezember: 12, diciembre: 12 };
  const MON_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).map(escRe).join('|');
  function datesIn(text0) {
    const text = String(text0 || '').replace(/[–—]/g, '-');
    const out = [], Y = '((?:18|19|20)\\d\\d)';
    const push = (y, m, d, weak) => { if (+m > 12 || +d > 31) return; out.push({ y, m: m ? pad2(+m) : '', d: d ? pad2(+d) : '', weak: !!weak }); };
    let m;
    for (m of text.matchAll(new RegExp('\\b(\\d{1,2})[./-](\\d{1,2})[./-]' + Y + '\\b', 'g'))) {
      const a = +m[1], b = +m[2];
      if (a <= 12 && b > 12) push(m[3], a, b); else push(m[3], b, a); // ordine USA solo se il giorno è > 12 / US order only when the day is > 12
    }
    for (m of text.matchAll(new RegExp('\\b' + Y + '-(\\d{2})-(\\d{2})\\b', 'g'))) push(m[1], m[2], m[3]);
    for (m of text.matchAll(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th|°|º)?(?:\\s*(?:-|to|and|&|e|y|et|und)\\s*(\\d{1,2})(?:st|nd|rd|th)?)?\\s+(?:of\\s+)?(' + MON_RE + ')\\.?,?\\s+' + Y + '\\b', 'gi'))) {
      const mo = MONTHS[m[3].toLowerCase()]; push(m[4], mo, m[1]); if (m[2]) push(m[4], mo, m[2]);
    }
    for (m of text.matchAll(new RegExp('\\b(' + MON_RE + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*-\\s*(\\d{1,2})(?:st|nd|rd|th)?)?,?\\s+' + Y + '\\b', 'gi'))) {
      const mo = MONTHS[m[1].toLowerCase()]; push(m[4], mo, m[2]); if (m[3]) push(m[4], mo, m[3]);
    }
    if (!out.length) for (m of text.matchAll(new RegExp('\\b(' + MON_RE + ')\\.?,?\\s+' + Y + '\\b', 'gi'))) push(m[2], MONTHS[m[1].toLowerCase()], '');
    if (!out.length) for (m of text.matchAll(new RegExp('\\b' + Y + '(?:\\s*(?:-|to|and|&)\\s*' + Y + ')?\\b', 'g'))) { push(m[1], '', '', true); if (m[2]) push(m[2], '', '', true); }
    return out;
  }
  const fmtDate = (d) => [d.y, d.m, d.d].filter(Boolean).join('-');
  function recordingDates() {
    const key = (d) => d.y + (d.m || '00') + (d.d || '00');
    const sentences = (D.notes || '').split(/\n+|(?<=[.!?])\s+/).filter((x) => /\b(record(ed|ing|ings)|registrat[oaie]|registrazion[ei]|enregistr|aufgenommen|grabad[oa]|tracked)\b/i.test(x));
    let dates = sentences.flatMap((x) => datesIn(x));
    let why = say('note', 'notes');
    if (!dates.length && /\blive\b|\bconcert/i.test(D.title || '')) { dates = datesIn(D.title || '').filter((d) => !d.weak); why = say('titolo del live', 'live title'); }
    dates = dates.filter((d) => +d.y >= 1877 && (!D.year || +d.y <= +D.year));
    if (!dates.length) return null;
    dates.sort((a, b) => key(a).localeCompare(key(b)));
    const from = dates[0], last = dates[dates.length - 1];
    return { from, to: key(last) !== key(from) ? last : null, why };
  }

  // Lingue dei testi stimate dai titoli; niente lingua per release strumentali
  function lyricLanguages(T) {
    const styles = (D.styles || []).concat(D.genres || []).join(' ').toLowerCase();
    const vocals = (D.creditList || []).some((c) => /vocal|voice|lyrics|\brap\b|singer|\bmc\b|spoken/i.test(c.role));
    if (/\b(ambient|drone|instrumental|noise|field recording|techno|house|trance|minimal|idm|electro|breakbeat|drum n bass|jungle|classical|post-rock|jazz|experimental)\b/.test(styles) && !vocals) return [];
    const rows = T.tracks.filter((t) => !t.header && !/^\[untitled\]$/.test(t.title));
    const votes = {};
    rows.concat([{ title: T.title }]).forEach((t) => {
      const ti = t.plain || t.title || '';
      const l = detectLangStrong(ti);
      const name = RYM_LANG[l] || (l === 'zz' ? scriptLang(ti) : '');
      if (name) votes[name] = (votes[name] || 0) + 1;
    });
    const min = Math.max(1, Math.ceil(rows.length * 0.2));
    return Object.entries(votes).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 3);
  }

  // Testo per il campo Sources: solo il link alla fonte
  function sourcesText() {
    const url = (D.url || '').replace(/\(/g, '%28').replace(/\)/g, '%29');
    return url;
  }

  // Crediti: ruoli Rym ufficiali (pagina "Music roles")
  const RYM_ROLES = new Map('10-string double violin|12-string acoustic guitar|12-string baritone guitar|12-string bass|12-string electric guitar|12-string guitar|12-string lead guitar|2-row accordion|2D animator|2D design|3-row diatonic button accordion|3D animator|3D modeling|6-string bass guitar|7-string acoustic guitar|8-string guitar|A clarinet|A&R administrator|A&R chief|A&R coordinator|A&R desk|A&R director|A&R executive|A&R manager|A&R producer|A&R supervisor|accompanist|accordina|accordion|accountant|Acetone organ|acme siren|acoustic baritone guitar|acoustic bass|acoustic guitar|acoustic piano|acoustic piccolo bass|acoustic rhythm guitar|action camera|actor|ad-libs|adaptation|additional animator|additional arranger|additional art|additional backing vocals|additional bass|additional composer|additional design|additional director|additional drums|additional effects|additional engineer|additional executive producer|additional guitar|additional instrumentation|additional keyboards|additional lyricist|additional manipulation|additional mastering engineer|additional mixing engineer|additional orchestra|additional orchestration|additional overdubbing|additional percussion|additional photography|additional piano|additional post-production|additional producer|additional programming|additional rhythm arrangements|additional sound design|additional vocal arrangements|additional vocals|adjá|administrator|adufe|adungo|adungu|Aeolian harp|agogô|agoual|agwal|ajaeng|akonting|alarm clock|alboka|album title|alfaia|algoza|alperidoo|alphorn|alto balalaika|alto clarinet|alto cornamuse|alto crumhorn|alto flute|alto fluteophone|alto guitar|alto horn|alto kamancheh|alto psaltery|alto rebec|alto saxophone|alto shawm|alto trombone|alto viol|alto violin|alto vocals|altyn shoor|Aluphone|amadinda|ambisonics|amplification|amplified objects|amplified piano|amplified sitar|amyrga|analog delay|analog sequencer|analog synthesizer|analogue electronics|anandi|angklung|Anglo concertina|angular harp|animal noises|animal trainer|animated art|animation director|animation producer|animator|ankle bells|announcer|antiphony|apito|Appalachian dulcimer|arbajo|archaic fretless zithers|arched harp|archive engineer|archivist|archlute|ardin|Argentinean guitarrón|arghul|ARP|ARP Explorer I|ARP Odyssey|ARP Solina string synthesizer|arpa jarocha|arpeggione|arpegina|arrangement supervisor|arranger|art|art concept|art department|art department assistant|art direction|art manipulation|art producer|art supervisor|artist manager|artist promotion|artistic assistant|artistic director|artists and repertoire|artwork restoration|asatayak|ashiko|askavlos|assembly editor|assistant art director|assistant choreographer|assistant conductor|assistant coordinator|assistant designer|assistant director|assistant engineer|assistant executive producer|assistant grip|assistant leader|assistant manager|assistant mastering engineer|assistant producer|assistant production manager|assistant production supervisor|assistant scenographer|assistant set designer|assistant set manager|assistant vocal engineer|assistant vocal recording engineer|associate director|associate executive producer|associate music director|associate producer|atabal|atabaque|atarigane|atenteben|atmosphere|attributed|atumpan|audio restoration|aulos|author|authoring|auto-wah|autoharp|axabeba|ayoyote|aşik sazı|A♭ clarinet|A♮ clarinet|B-Bender|babatoni|back cover art|back cover photography|background actors\' coordinator|background artist|backing band|backing vocal arrangements|backing vocals|backline technician|backstage photography|backup dancer|bagpipes|Bahian gaita|Bahian guitar|bajo quinto|bajo sexto|bak|Bakhshi staccato ornamentation|balafon|balalaika|ballet dancer|balloon|Baltic psalteries|bamboo flute|bamboo saxophone|bamhum|ban-sitar|band photography|bandola|bandolim|bandolin|bandoneón|bandora|bandura|bandurria|bangzi|banjeaurine|banjo|banjola|banjolele|banjolin|bansuri|bantar|barabanka|barbat|barbiton|baritone Anglo concertina|baritone guitar|baritone horn|baritone saxophone|baritone ukulele|baritone violin|baritone vocals|barking dog|Baroque bassoon|Baroque cello|Baroque flute|Baroque guitar|Baroque harp|Baroque oboe|Baroque trumpet|Baroque viola|Baroque violin|barrel organ|barrel piano|baryton|baryton-Martin|bas|bas-prim|basolia|bass|bass Anglo concertina|bass balalaika|bass banjo|bass clarinet|bass cornamuse|bass crumhorn|bass drum|bass dulcian|bass flugelhorn|bass flugelhorn in B♭|bass flute|bass guitar|bass guitar synthesizer|bass harmonica|bass lute|bass marimba|bass moraharpa|bass nyckelharpa|bass oboe|bass pan|bass pedals|bass piano accordion|bass programming|bass psaltery|bass pulse|bass rebec|bass recorder|bass recording engineer|bass sackbut|bass santur|bass saxophone|bass synth keyboard|bass technician|bass trombone|bass trumpet|bass tuba|bass tube|bass tār|bass ukulele|bass veena|bass viol|bass violin|bass vocals|bass-baritone vocals|basset clarinet|basset horn|bassetto|basskannel|basso profondo|bassoon|basy kaliskie|bat kine|Batajón|Batajón Itotele|Batajón Iya|Batajón Okónkolo|baton|battala|batá|bawa|bawu|bayan|Bayanola|bazooka|bağlama family|baş sazı|beat box|beats|beauty stylist|bedug|begena|Belarusian duda|bell tree|bells|bena|bendir|benyol|berimbau|best boy|bhapang|bianqing|bianzhong|bijol|bilo|binioù kozh|birbynė|birch trumpet|bird call|bisernica|bishguur|biwa|bladder fiddle|blarge|blowing horn|blul|bo|boatswain\'s call|bodega|bodhrán|body percussion|boha|bolon|bombard|bombardon|bombo|bonang|bonang barung|bonang panerus|bones|bongos|book|booklet|booklet cover|booklet design|booklet photography|booklet structure|Boomwhacker|border pipes|bordonúa|botalo|botija|bottle|bottleneck guitar|boté|bougarabou|boula|bouzouki|bouzouki-guitar|bow harp|bow-shaped Jew\'s harp|bowed banjo|bowed bass guitar|bowed electric guitar|bowed glockenspiel|bowed guitar|bowed gusli|bowed lute|bowed psaltery|bowls|boîte à bourdons|braithophone|brake drum|brass|brasswinds|Brazilian fife|Brazilian guitar|breakbeats|breakdancer|breaking glass|bridge vocals|bronté|broom|brushes|BTS DP|bucium|Buddha machine|bugarabu|bugarija|bugle|buhay|buisine|bukhalo|bukkehorn|bulbul tarang|bulgari|Bulgarian tambura|bull horn|bullroarer|bungkaka|button accordion|buzuq|buzzer|byou uchi-daiko|byzaanchy|Byzantine lyra|béndré|B♭ clarinet|B♭ soprano sarrusophone|B♭ soprano saxophone|B♭ trumpet|B♭ whistle|C clarinet|C soprano saxophone|C trumpet|C whistle|c-melody saxophone|cabasa|cabrette|cacho|cadenza|caixa|caixa de folia|caja andina|caja vallenata|cajita china|Cajun accordion|cajón|calabash|Calabrian lira|caller|calligraphy|calliope|camcorder operator|cameo|camera assistant|camera control unit|camera operator|campana|campanula|can-jo|candombe drums|cantaor|cantaro|cantor|capped reeds|card design|caricature|carillon|Carlsfelder concertina|carnyx|carts|castanets|casting|casting associate|casting director|CAT synthesizer|cathedral organ|catá|cavaquinho|caxixi|caña rociera|CD player|CD prep|cedar flute|celempung|celesta|cello|cello banjo|cello da spalla|cello pan|Cellotar|Celtic harp|cetara|ceterone|cevgen|CG artist|CG director|ch\'ili|chabbaba|chadagan|chain saw|chajchas|chakhe|chalumeau|chamber organ|Chamberlin|changi|chant|chanza|chapey|Chapman Stick|character designer|charango|charanguita|charangón|chardha|charrasca|chaturangu|chelys|Chemnitzer concertina|chief director|chief planner|chief producer|chijin|child vocals|children\'s choir|Chilean guitarrón|chime tree|chincha quena|chinchín|chindon|ching|chitarra battente|chitarrone|chitravina|choghur|choir|choir organ|choirmaster|chopping and screwing|choquela|choral arrangements|choral lyricist|chord harmonica|chord organ|Chorda|chordophones|choreographer|chorus|chorus effect|chromatic accordion|chromelodeon|chuniri|churuca|chuzao shamisen|chácaras|chácharo|cigar box guitar|cimbalom|cimbasso|cimpoi|cinco|cinematographer|circuit bending|cirrampla|cithara|citole|cittern|clarin|clarinet|clarisax|clarophone|classical kemenche|claves|clavicembelo|clavichord|clavicymbalum|clavicytherium|Clavinet|claviola|Clavioline|claviorgan|claymation|clayrimba|clean vocals|CLEX|click sticks|clock|clockworks|clog dancer|clog violin|cloud-chamber bowls|clàrsach|co-arranger|co-director|co-executive producer|co-producer|co-sound producer|co-writer|cobza|cocktail drum|colascione|collage artist|Colombian gaita|Colombian tambora|color coordinator|color designer|color grading|colorist|comb|combolin|comedian|comic book|comics|Companion organ|compilation engineer|compilation producer|compiler|composer|composer coordinator|composer\'s assistant|compositing|composition|compressor|computer|computer animation|computer manipulation|computer programming|concept|concert promotion|concert timpani|concert uilleann pipes|concert ukulele|concertina|concertmaster|conch shell trumpet|condanctor|conductor|congas|Conn-o-sax|console steel guitar|consultant|contact microphone|content structure|content structure assistant|Continuum Fingerboard|contra-alto clarinet|contrabass balalaika|contrabass clarinet|contrabass flute|contrabass guitar|contrabass recorder|contrabass saxophone|contrabass trombone|contrabassoon|contraforte|contraguitar|contralto saxophone|contralto vocals|contraviola|cookbook|cooperator|coordinator|copyist|copywriter|cornamuse|cornemuse du Centre|cornet|cornett|corrugaphone|Cosmic Beam|costume assistant|costume designer|couesnophone|countertenor vocals|cover art|cover concept|cover coordinator|cover design|cover illustration|cover model|cover photography|cover styling|cow horn trumpet|cowbell|cracked everyday electronics|Cracklebox|crane operator|crash box|Craviola|creative coordinator|creative director|creative producer|creator|Cretan laouto|Cretan lyra|cristal Baschet|cromorne|crotales|crowdy-crawn|crumhorn|cruzaphone|crwth|cuatro|Cuban tres|cuica|cultrun|cumaco|cununo|cura|curator|cutting engineer|cymbals|cymbow|cümbüş|cümbüş tanbur|D whistle|da\'uli da\'uli|daejaeng|dalang|daluo|damaha|damaru|dambus|dancer|dang bipa|danso|darabukka|daruan|daudytės|davul|daxophone|dayereh|death whistle|deejay (vocals)|deff|delay|dengakubue|denshig|design|design coordinator|design director|design producer|desk|desktop publishing|devangui|devices|devil\'s fiddle|dhantal|dhog-dhog|dhol|dholak|dholki|dhyangro|dialogue editor|diatonic accordion|dictaphone|dictation machine|diddley bow|didgeridoo|Didjeribone|digital audio workstation|digital delay|digital editing|digital engineer|digital imaging technician|digital mastering|digital painting|digital reverb|digital sequencer|digital transfer|dilruba|ding|dingulator|diplica|diplipito|direct metal mastering|director|director of choreography|disc design|disc production assistant|disc production director|distortion|divan sazı|division viol|diyinruan|dizi|DJ|DJ controller|DJ mixing|djembe|djoze|Dobro|Dobro bass|dobulbash|dojo|dolceola|dolly grip|dombura|Dominican tambora|domra|donno|donso n\'goni|door spring|doshpuluur|dotar|dotar gourd lute|dotara|double|double bass|double clarinet|double flute|double reed|double second|double tenor|double-action harp|double-headed drums|doundoumba|dragon\'s teeth|dramaturge|dramyen|drawings|dressmaker|drill|driver|drone fiddle|Drone Machine|drone operator|drum arrangements|drum director|drum editing|drum kit|drum loops|drum machine|drum pad|drum programming|drum recording engineer|drum technician|drums|dual-bell trumpet|dub|ducheke|duck call|duclar|dude|duduk|dudy|duet concertina|duggi tarang|dulce melos|Dulcetina|dulcian|dulcimer|dulcitone|dulzaina|dungchen|dungdkar|dunun|dutar|duxianqin|DVD player|dvojnice|dwojnica|dùndún|düngür|EBow|echo cornet|editing|editing assistant|editorial coordinator|effects|Eigenharp|ektara|ekue|ekwe|electric autoharp|electric bandolim|electric banjo|electric baritone guitar|electric bass|electric bass dombra|electric bouzouki|electric cello|electric cellotar|electric dombra|electric grand piano|electric guitar|electric harp|electric harpsichord|electric kalimba|electric keyboard|electric mandola|electric mandolin|electric oud|electric piano|electric piccolo bass|electric rake|electric rhythm guitar|electric saw|electric saz|electric solid-body banjo|electric soprano guitar|electric spoons|electric tambourine|electric tenor guitar|electric tres|electric trombone|electric trumpet|electric ukulele|electric upright bass|electric vibraphone|electric viola|electric viola da gimbri|Electric Viola Grande|electric violin|electric zither|electric-acoustic guitar|electrical assistant|electrician|electro-theremin|electrocardiophone|electrochord|electroencephalophone|electroneddas|electronic bagpipes|electronic drums|electronic effects|electronic organ|electronic percussion|electronic piano|electronic tanpura|electronics|electronics / electromechanical devices / machines|electrophone|elong|embaire xylophone|Emulator|end-blown flutes|endangered guitar|energized surfaces|engineer|engineer coordinator|engineering|engineering supervisor|English concertina|English guitar|English horn|enhanced content creator|ensemble|equipment technician|ergek shoor|erhu|erke|erxian|esraj|esseharpa|esterilla|etching artwork|ethnographic consultant|euphonium|ever buree|EVI|ewartophone|Ewe drums|EWI|executive coordinator|executive director|executive producer|executive sound producer|executive supervisor|extra|E♭ clarinet|E♭ contrabass sarrusophone|E♭ whistle|F bass flute|F whistle|Fairlight|falsetto|fan|Fanfarlophone|fanfrnoch|Farfisa|fashion director|featured|feedback|felt piano|ferrinho|fiddlesticks|fidel płocka|field organ|field recordings|fife|fight choreographer|filimbi|filmmaker|filouphone|final engineering|finger cymbals|finger snaps|finish|fire extinguisher|first assistant camera|first assistant director|first lighting assistant|first tenor vocals|first violin|fiscorn|five string banjo|fiðla|flabiol|flabuta|flageolet|flamenco dancer|flamenco guitar|flanger|flapamba|flat-set uilleann pipes|flauta de millo|Flemish bagpipes|flexatone|flogera|floor slide|floor tom|fluba|flugelhorn|fluid piano|fluier|flumpet|flute|flute arrangements|fluteophone|flutonette|flûte d\'amour|foghorn|FOH engineer|foot stomper|foot tapping|fortepiano|fou|founder|four string banjo|four-course bouzouki|fractal art|frame drum|Franglo concertina|free reeds|French horn|fretless banjo|fretless bass|fretless guitar|fretless zither|fretted dulcimer|friction drum|friction idiophones|front cover art|front cover photography|fruja|frula|fuhun|fujara|funde|furruco|futozao shamisen|futujara|fuyara|fuzz|fyell|G clarinet|G whistle|gachi|gadulka|gaffer|gaida|gaita|gaita asturiana|gaita charra|gaita de caboclinho|gaita de foles|gaita hembra|gaita macho|gaita ponto|gaita transmontana|gajdica|gaklab|gallal|gambang kayu|Game Boy|game call|gamelan|gandang|gandharvi|gang vocals|gangkoqui|gangsa|gangsa gong|gangsa kantilan|gangsa metallophone|gangsa pemadé|ganza|gaohu|gaoyinruan|garden rake|gardon|Garifuna drum|garklein recorder|garmon|gasba|Gbedu|gemshorn|gendér|gendér barung|gendér panerus|general assistant|general producer|general sound producer|general supervisor|gentorak|geomungo|German concertina|ghatam|ghaychak|ghungroo|gidjak|gitouki|gittern|glass harmonica|glass harp|glass marimba|Glissando Headjoint flute|Glissentar|glockenspiel|glossolalia|goat horn trumpet|goblet drum|goje|gome|gong|gorosu|gottan|goura|gourd banjo|graffiti|grage|graile|gralla|gralla baixa|gralla curta|gralla dolça|gralla llarga|gralla subbaixa|gramophone|grand piano|grande bourbonnaise|grandes cornemuses du Centre|granular synthesizer|graphic design|graphics|graphics coordinator|graphics layout|graw|great bass crumhorn|great Highland bagpipes|Greek baglama|grip|groovebox|group|growls|guacharaca|guache|guan|guasá|guayo|gudastviri|gudok|guest|guest speaker|guide-chant|guitalele|guitalin|guitar|guitar loops|guitar phím lõm|guitar recording engineer|guitar synthesizer|guitar technician|guitar-o-lin|Guitaret|guitarra conchera|guitarra de golpe|guitarra-da-terra micaelense|guitarra-da-terra terceirense|guitarrino|guitarro|guitjo|guitolão|guitorgan|gumbass|gungon|guqin|gusle|gusli|gut-string guitar|guzheng|gwoka|gyaling|gyil|güira|güiro|h\'arpeggione|Hadjira|haegeum|hair stylist|hair stylist assistant|halldorophone|hambone|hammer|hammered dulcimer|Hammond organ|hand gong|hand percussion|handbells|handclaps|Hang|hapi drum|hard drives|Hardanger d\'amore|hardingfele|harmonic cannon|harmonica|harmonies|harmonium|harmony composer|harp|harp guitar|harp-lute|harpejji|harpsichord|Harryphone|harsh vocals|haute-contre|Hawaiian guitar|hayashi|head of creative|headless tambourine|headphones|hearpe|heckel-clarina|Heckelphone|hegelung|helicon|heligonka|hi-hat|hichiriki|highland hornpipe|hindehoo|hirtenschalmei|homemade instruments|hooked harp|hooligan drums|horagai|horn|horn arrangements|hosho|hosozao shamisen|host|hot fountain pen|huapanguera|hubcap|hulusi|hummel|humming|Hungarian citera|hunting horn|huobosi|huqin|hurdy gurdy|huēhuētl|hyang bipa|hype man|hyperbass flute|hyōshigi|härjedalspipa|hümmelchen|idioglottic reed|idiophones|ieta|igil|ikh khuur|illustration|ilu|image consultant|image editor|image selection|images|immersive mixing engineer|imzad|inbetween animation checker|inbetween animator|incantation|Indian harmonium|Indian slide guitar|Indian tambura|Innato flute|innenklavier|inner design|inner photography|inner sleeve photography|insert design|instructor|instrument maintenance|instrument technician|instrument tuning|instrumentation|instruments|instruments recording engineer|international marketing|interviewee|interviewer|intimacy coordinator|intonarumori|iPad|iPod|ipu|Irish bouzouki|Irish flute|Irish tenor banjo|isitontolo|itótele|iyá|jal tarang|jaleo|jam block|jaminator|jang sae-nap|janggu|Jankó keyboard|jarana huasteca|jarana jarocha|jarana primera|jarana segunda|jauram|jawbone|jawsaphone|jazzophone|jejy voatavo|jeli n\'goni|jengglong|jentreng|Jew\'s harp|jewelry|jez kernei|jib operator|jing|jouhikko|jouras|jublag|jug|jungga|junggeum|junghaegeum|junjung|jushichi-gen|jwago|jīnghú|k\'lông pút|kabosy|kabuli rebab|kacapi|kacapi indung|kacapi rincik|kachapitar|kaganu|kagurabue|kalyuka|kamalen n\'goni|kaman|kamayacha|kamānche|kane|kangling|kanjira|kanklės|kannel|kanonaki|kanrang|kantele|kanun|Kaoss Pad|karinding|karinian|kartal|kaser|kaval|kawala|kayagum|kayamb|kazoo|Kazooka|kaşık|kebero|kecrek|kecèr|kemenche|kempli|kempul|kendang lanang|kengirge|kenken|kenkeni|kenong|kepyak|kethuk|key animator|key grip|key hair stylist|key makeup|keyboard arrangements|keyboard programming|keyboard sitar|keyboard technician|keyboards|keymonica harmonica|keyolin|keytar|kha dae-kha bart|khaen|khaen baet|khaen jet|khanwe|khapchyk|khloy|khlui|khomok|khoomei|khulsan khuur|khurtal|khuuchir|kick drum|kick snare|kidumbak|kissar|kit violin|kitchen utensils|kkwaenggwari|klavifon|klaxon|klentong|knee slapping|knife|kobyz|kobza|kokiriko|kokle|kokyū|kologo|koncovka|kong vong toch|konghou|konnakol|kontra|kontrasípos duda|kopuz|kora|Korean jabara|kortholt|kotamo|koto|krachappi|krar|kroboto|kromaatiline kannel|kroncong|kse diev|kubing|kubyz|kuduhorn|kudüm|kugikly|kuhmoongo|kukkopilli|kulcapi|kulintang|kunstharmonium|kutiriba|kutirindingo|kutiro|kutiyapi|kyam|kyl kyiak|kyêma|kèn|kōauau|kūchō|kơ ní|Labanoro dūda|label assistant director|label design|label director|lagerphone|lali|lambe|lamellate Jew\'s harp|lamellophones|langden|langeleik|langspil|language consultant|language instructor|laouto|lap pedal steel guitar|lap steel|laser harp|laterna|Latin percussion|launeddas|lavta|layout|layout restoration|laúd|lead arranger|lead CG artist|lead composer|lead compositor|lead dancer|lead guitar|lead tenor vocals|lead vocals|leader|leading actor|legal|leona|lepenelauta|Leslie speaker|librettist|light board operator|lighting|lighting assistant|lighting designer|lighting director|lighting operator|limbi|line producer|liner notes|liner notes design|liner notes editor|liner notes translator|lingm|Linn LM-1|LinnStrument|liquindi|lira|lira da braccio|lirone|lithophone|litungu|liuqin|live coding|live electronics|live producer|live recording crew|live recording engineer|live sampling|live sound engineer|live vocal processing engineer|llautë|location coordinator|location manager|location scout|log drum|logger|logistics|logo|lokanga bara|lokolé|long string drone|long string instrument|loops|loudspeaker|lounga|low D whistle|low whistle|Lowrey organ|ludaya|luikku|lujon|Lumatone keyboard|lumzdelis|lur|lurk|lusheng|lute|lute guitar|lute-harpsichord|lyra|lyra viol|lyre|lyric baritone vocals|lyric tenor vocals|lyrical concept|lyricist|Lyricon|lyrics consultant|lyrics translator|låtfiol|låtmandola|Léode|lõõtspill|m\'bung m\'bung|M4|madal|magnetic cartridge|magnetic resonator piano|Mahai Metak|makeup|makeup assistant|makhoyane|makwa|male soprano vocals|MalletKAT|mallets|malta|management desk|manager|mando guitar|mandobass|mandocello|mandol|mandola|mandolin|mandolin-banjo|mandolino|mandoliny|mandolone|mandolute|mandora|mandozither|manga|mangala vadya|manicurist|manipulation|manipulation assistant|manzello|mapping|maracas|maracones|marching drums|marching trombone|marimba|marimba de chonta|marimbaphone|marimbau|marketing|marketing assistant|marketing cooperation|marketing director|marketing planner|Martinshorn|Marxophone|marímbula|masankop|masenko|mastering consultant|mastering coordinator|mastering engineer|matchbox|matófono|mazanki|mazhar|mbira|MC|media manager|medieval harp|megaphone|mejoranera|mellophone|mellophonium|Mellotron|melodeon|melodeon accordion|melodeon organ|melodica|membranophones|merchandiser|metal pipes|metallophones|metronome|Mexican guitarrón|Mexican tambora|Mexican vihuela|meydan sazı|mezzo-soprano saxophone|mezzo-soprano vocals|mi-solo guitar|Micromoog|microphone|microtonal bass guitar|microtonal electric guitar|microtonal guitar|MIDI|MIDI controller|MIDI programming|milanolo|military band|military snare drum|mime|mini 12-string guitar|MiniDisc|Minimoog|miraj|mirwās|misattribution|mixing assistant|mixing consultant|mixing coordinator|mixing engineer|mizwid|mišnice|mobile phone|model|modular synthesizer|mohan veena|mohoceño|monitor engineer|monkey stick|monochord|Monome grid|moo box|Moodswinger|Moog|Moog Liberation|Moog Taurus bass|mora-oud|moraharpa|morchunga|morin khuur|moringa|morsing|motion graphics design|motorized devices|mouth music|mouth speaker|mouthpiece|movement director|MPC|mridangam|mukkur|multi audio engineer|multi-instrumentalist|murgu|musette|musette Béchonnet|music box|music contractor|music designer|music director|music librarian|music production director|music programming|music supervisor|musical assistant|musical bow|musician coordinator|mute cornett|muyuz kernei|mwanzi|mänkeri|mùyú|müsa|n\'goni|n\'vike|nafīr|nagada|nagado-daiko|nagaswaram|Nagoya Harp|nai|nail violin|nakers|naqareh|naqos|narration|narsinga|nasal chorus|Native American flute|nattuvangam talam|natural horn|natural trumpet|nağara|ndehou|ndzedze|Nepali flute|Nepali sarangi|ney|ngoma|ngombi|nickelodeon|niju-gen|no-input mixing board|noh utai|nohkan|noise|noise generator|Northumbrian pipes|Norwegian lyre|nose flute|nose organ|Novachord|Novation Launchpad|novel|NS/Stick|Nyabinghi drums|nyangile|nyatiti|nyckelharpa|o\'ele\'n strings|objects|oboe|oboe d\'amore|oboe da caccia|ocarina|Ocean drum|ochlebky|octave mandola|octave splitter|octave violin|octobass|octophone|offline editing|okónkolo|olifant|omele méta|Omnichord|ondes Martenot|Ondioline|online editing|ophicleide|optical synthesizers|Optigan|Optron|orchestra|orchestral accompaniment|orchestral arrangements|orchestral percussion|Orchestron|organ|organetto|organistrum|orpharion|orutu|oscillator|Otamatone|oud|oungum|overdrive|overtone flute|overtone singing|ožragis|p\'iri|package coordinator|package design|packaging|packaging art direction|Paetzold recorder|page turner|pahu|paimensoittu|painting|pakhawaj|palheta|palitos|palmas|Pamiri rubab|Pamiri tanbur|Pamiri tar|pan flute|pandeiro|pandero cuadrado de Peñaparda|pandero jarocho|pandur|pandura|panduri|panhuēhuētl|pansori aniri|pansori gosu|Papoose|Paraguayan harp|parai|pardessus de viole|parkapzuk|parkour|patsu|Pedabro|pedal accordion|pedal harp|pedal keyboard|pedal piano|pedal steel guitar|pedals|pena|pencilina|penny whistle|pentarpa|penyacah|pepa|percuphone|percussion|percussion arrangements|percussion programming|percussive dance|percussive objects|percuteria|performance supervisor|performer|Persian bagpipe|phaser|Philicorda|phin|phin nam tao|phin pia|phonograph|photographic assistant|photography|phototypesetting|physiophonograph|phách|pi joom|Pianet|piano|piano accordion|piano arrangements|piano harp|piano recording engineer|piano technician|piano wire|pianola|pianolin|pibgorn|piccolo|piccolo Anglo concertina|piccolo balalaika|piccolo bass|piccolo guitar|piccolo oboe|piccolo trombone|piccolo trumpet|pickup|pifana|piffero|pifre|Pikasso guitar|pinkillo|pipa|pipe|pipe organ|piri|pistoñ|pitch pipe|pitched percussion|pito herreño|piva|pixel art|pixiphone|pkhachich|pku|placeholder art|planner|planning adviser|plastic bucket|plate reverb|plating engineer|playback engineer|Playtron|plectrum guitar|pleneras|plosive aerophones|pocket cornet|pocket trumpet|podorythmie|poet|poica|Polymoog|polyphonia harmonica|polyphonic synthesizer|pommer|pone pon|Pontic kemenche|pook|popping|portative organ|portrait photography|Portuguese cavaquinho|Portuguese guitar|positive organ|post horn|post-production|post-production assistant|post-production manager|post-production supervisor|poster design|pots|pots and pans|practice chanter|practice goose|prato-e-faca|pre-production|preaca|precision driver|premastering engineer|premixing engineer|prepared bass guitar|prepared double bass|prepared drums|prepared guitar|prepared harpsichord|prepared piano|prepared Sardinian guitar|preret|presenter|press release|prim|prima balalaika|principal bass|principal cello|principal dancer|principal flute|principal viola|prkno|Pro Tools|processing|producer|product coordinator|product design|product manager|product producer|production|production assistant|production consultant|production control|production cooperator|production coordinator|production desk|production director|production engineer|production manager|production supervisor|programming|programming assistant|project assistant|project coordination|project producer|project supervisor|Projectron|promotion chief|promotion desk|promotion supervisor|proofreader|Prophet 5|Prophet-10|props|prosvirelka|psalmodicon|psalterium|psaltery|pseudo-organ|pshina|public address technician|public relations|publicist|publisher|Puerto Rican cuatro|Puerto Rican tres|puik-puik|puili|pungi|puppet designer|puppeteer|purring|putipù|PVC pipes|pyngyr|pyrotechnician|pythagorean harp|pyzhatka|pūtōrino|qamlapsh|qanbūs|qiben|qilaut|qing|qinqin|qraqeb|quadraphant|quartara|quena|quenacho|Quindola|quinto|quinton|quitiplás|rabeca|rabel|rackett|radio|radio transmitter|raft zither|rahvakannel|rainstick|rajão|ranat ek|rap|rap arrangements|ratchet|rattle|rauschpfeife|ravanhatta|ravanne|rawap|re-editing|re-recording engineer|re-recording mixer|Reactable|reamping|rearranger|rebab|rebana|rebec|rebolo|recitation|record executive|recorder|recording assistant|recording coordinator|recording director|recording engineer|recording equipment|recording manager|recording producer|recording supervisor|recordings|redactor|reed organ|reed trumpet|regal|reissue supervisor|release operator|remastering engineer|remixer|remixing engineer|renaissance guitar|Renaissance violin|rendering|repeater|repinique|repique de mão|requinto guitar|requinto jarocho|research|resident|resistor|resonator guitar|resonator mandolin|reverb|reverse flugelhorn|reyong|rhaita|rhamani|Rhodes|rhymes|rhythm guitar|rhythm programming|rhythm section|rhythm section arranger|rhythm sticks|ribbon reed|Richter-tuned harmonica|ride cymbal|rim-blown flutes|rindik|ring modulator|riq|roadie|rocar|Roman bells|rommelpot|rondador|roneat ek|ronroco|rosem|roto-tom|rozhok|ruan|rubarp|rubber bands|rudra veena|Rumorarmonio|runner|Russian guitar|rute|ryuteki|sabar|sabar n\'der|sabaro|sac de gemecs|sackbut|saenghwang|saggeypo|salamuri|salo|salpinx|saluang|Samchillian|samica|samjuk|sample clearance|sample preparation|sampler|sampling|sanba|sandpaper blocks|sangban|sanshin|santoor|santur|sanxian|sapeh|Sardinian guitar|sarinda|sarod|saron|saron barung|saron demung|saron panerus|saron wayang|sarrusophone|sarune|sasando|sassa|satar|sato|satârâ|saung|saw|saw sam sai|saw u|saxello|saxhorn|saxobone|saxonette|saxophone|saz|sazabo|scanning|scat|scenographer|scetavajasse|scheitholt|Schrammelharmonika|schreierpfeifen|Schwyzerörgeli|schäferpfeife|score preparation|score reconstruction|Scottish smallpipes|Scottish snare drum|Scottish tenor drum|scraper|scratching|screenprint|script supervisor|scriptwriter|scythe|se|Seaboard|second assistant camera|second assistant director|second cello|second lighting assistant|second tenor vocals|second unit director|second viola|second violin|seeds|sekunda balalaika|selector|self-oscillating drum|semi-acoustic guitar|Sensory Percussion|seperewa|sequencer|sequencing|serp|serpent|serpent Forveille|serraggia|serunai|session manager|session musician|session vocalist|set builder|set designer|set dresser|set manager|setar|setor|seul|Shah Kaman|shahi baaja|shakers|shakubyōshi|shakuhachi|shamisen|shantu|shanz|shargia|shawm|shehnai|shekeres|shells|sheng|sherter|shime-daiko|shinobue|shishi-odoshi|shofar|shoor|shrieks|shuangqing|shulberry|shurangiz|shvi|shyngyrash|shō|sico|sign-language interpreter|sikulu|simbing|simsimiyya|singing bowls|single reed|single-headed dhol|single-stringed zithers|sintir|Sioux drum|sipsi|siren|sirenette|sistrum|sitar|sitar guitar|sitarla|sitello|siter|six string banjo|sixian|skratji|skudučiai|sleeve|sleeve coordinator|sleeve design|sleeve notes|sleeve photography|sleigh bells|slenthem|slide bass|slide clarinet|slide guitar|slide piano log|slide saxophone|slide whistle|slit drum|smart guitar|snare drum|social media manager|soft drink can|sogeum|sogo|sohaegeum|Solina|soloist|Soma pipe|somporing|song lang|song titles|songwriter|sopilka|sopranino clarinet|sopranino rauschpfeife|sopranino recorder|sopranino saxophone|sopranino schreierpfeifen|sopranissimo saxophone|soprano clarinet|soprano cornamuse|soprano cornet|soprano crumhorn|soprano dulcian|soprano flute|soprano guitar|soprano psaltery|soprano rebec|soprano recorder|soprano saxophone|soprano schreierpfeifen|soprano trombone|soprano violin|soprano vocals|sound|sound A&R|sound composer|sound consultant|sound coordinator|sound creator|sound designer|sound director|sound editor|sound effects|sound effects programming|sound icon|sound manager|sound operator|sound planner|sound producer|sound programming|sound sculpture|sound supervisor|sound support|souravli|source material supplier|sousaphone|Spanish guitar|Spanish vihuela|spark|special coordinator|special effects|special effects makeup|special effects supervisor|spilåpipa|spinet|spinet harpsichord|spinet piano|spinning drum|splash cymbal|spoken word|sponsor|spoons|spring drum|spring güiro|spring reverb|square piano|squeezebox|sruti box|stabule|stage director|stage engineer|stage producer|steadicam|steadicam assistant|steel drum|steel guitar|steel tongue drum|steel-string acoustic guitar|stem mastering|stereographer|stick dulcimer|stick zither|StikHarpe|stomp box|stones|story|storyboard artist|straight alto saxophone|straight tenor saxophone|street organ|string arrangements|string drum guitar|string engineer|string recording engineer|string synthesizer|strings|strings contractor|strings orchestrator|stritch|Stroh violin|structure writer|studio assistant|studio coordinator|studio personnel|stunt coordinator|stunt performer|stunt rigger|stylist|stylist assistant|stylophone|sub-contrabass balalaika|subcontrabass tubax|subtitles|subu|sueng|sugudu|suka|suling|sundatang|sundri|suona|Superbone|supervising producer|supervisor|surbahar|surdo|suupeli|Suzuki Andes|svirel|swarmandal|swarsangam|Swedish säckpipa|swing|symphonie|Synclavier|Syndrum|synthesizer|synthesizer manipulation|synthesizer operator|synthesizer pads|synthesizer programming|synthetic vocals|system engineer|sáo|sārangī|sīgǔ|t\'bel|taal|taawahekan|tabla|tabla tarang|tablak|table-top guitar|tabor|tabor pipe|tack piano|taegum|taepyeongso|Tahitian ukulele|taika|taiko|tailor|taishōgoto|talempong|talent agent|talharpa|talk box|talking drum|talutt|tam tam|tama|tamba|tambin|tambooro|tambor alegre|tambor llamador|tambor repicador|tambori|tamborim|tambour|tambouras|tambourine|tambura|tamburaško čelo|tamburello|tamburello marchigiano|tamburi|tamburica|tammorra|tanbou|tanbur|tanburag|tangent piano|tanjore|Tannerin|tantan|Taos drum|tap dancer|tap guitar|tape delay|tape loops|tape operator|tape replay keyboard|tapes|taphon|tar|tara quena|taraban|tarawangsa|Tarhu|tarija|tarima|tarka|tarol|tarota|tasha|taus|tav shvi|tavil|tañador|TB-303|tbilat|tea chest bass|technical assistant|technical director|technical production|technical supervisor|telegraph key|telenka|telephone|television|television producer|temple blocks|tenor banjo|tenor bass|tenor cornamuse|tenor cornett|tenor crumhorn|tenor drums|tenor dulcian|tenor guitar|tenor oboe|tenor pan|tenor psaltery|tenor rackett|tenor rauschpfeife|tenor recorder|tenor saxophone|tenor trombone|tenor ukulele|tenor viol|tenor violin|tenor vocals|tenora|Tenori-on|tenoroon|teponaztli|terraphone|tetsu-zutsu|teueikan|thammátama|theater organ|theorbo|theremin|third assistant camera|third assistant director|thon|three-course bouzouki|throat singing|thumbnail designer|thunder|thunder sheet|ti bwa|tianqin|Tibetan singing bell|tible|tifa|tilinkó|timba|timbal|timbales|timbalitos|timbrel|timpani|timple|tina|tindé|tingsha|tinya|tiorbino|tiple|tiptar|title card designer|title translation|titles|tlalpanhuēhuētl|tlapitzalli|to\'ere|TogaMan GuitarViol|tololoche|tom-tom|tonbak|Tonette|tongatong|tonkori|tonkorongh|topshur|torban|torototela|torupill|toubeleki|Touch Guitar|TouchMe|toudri|tour manager|touxian|toy clarinet|toy drums|toy guitar|toy instruments|toy keyboard|toy piano|toy saxophone|toy synthesizer|toy trumpet|toy xylophone|toys|tracanholas|track art|track commentary|tracking engineer|traditional dhol|train whistle|transcriber|transferring|translator|transpositeur|transverse flute|transverse mirliton flutes|transverse shakuhachi|transverso|trash can|Trautonium|treatments|treble Anglo concertina|treble flute|treble recorder|treble viol|treble violin|treble vocals|trembita|tremolo|tremoloa|tres|tres-dos|triangle|tribute to|triccheballacche|tricordia|trikitixa|trimba|triple guitar pan|triple harp|tro|tromba marina|trombone|trombonium|tromboon|trombophone|trompa de Ribagorça|Tronichord|trough zither|trumpbone|trumpet|trupé|trutruca|tréculas|trống chầu|trống cơm|tsampouna|Tsugaru shamisen|tsuzumi|tuba|tubaphone|Tubax|tube|tube drums|Tubon|tubular bells|tulum|tumba|tumur khuur|tun|tungna|tungso|tuning fork|turntable|turtle shells|tussefløyte|tuyug|tuyuk shoor|txalaparta|txistu|tyamko|tympanum|typesetting|typewriter|typography|tárogató|tār|u-bolt|uchiwa-daiko|udu|ugly stick|uhadi|uilleann pipes|ukulele|umakhweyana|umtshingo|umuduri|unit still photographer|unitar|unpitched percussion|upright piano|vaccine|vacuum cleaner|valdimbula|valide trombone|valiha|valve trombone|valve-slide trombone hybrids|valved cimbasso|variable tension chordophones|Variophone|Varitone|VCR|veena|Venezuelan cuatro|Venezuelan tambora|venu|veuze|VFX|VFX coordinator|VFX creative director|VFX producer|VFX supervisor|Vibra-Slap|Vibrandoneon|vibraphone|Vibratosax|vichitra veena|video assist operator|video commissioner|video concept|video director|video editing|video post-production|video producer|video production coordinator|video technician|videographer|vielle|viol|viola|viola amarantina|viola baixo|viola bastarda|viola beiroa|viola braguesa|viola caipira|viola caiçara|viola campaniça|viola cubana|viola d\'amore|viola de cocho|viola de fado|viola dinâmica|viole d\'Orphée|Violectra|violin|violin d\'amore|violin octet family|violin uke|violino grande|violone|virginals|virtual audio producer|vision mixer|visual collage|visual coordinator|Vitar|vivo|VJ|vocal arrangements|vocal coach|vocal consultant|vocal contractor|vocal direction|vocal editor|vocal effects|vocal engineer|vocal mixing|vocal percussion|vocal producer|vocal programming|vocal recording engineer|Vocaloid|vocals|vocoder|voice actor|voice flute|volynka|vozembouch|VR producer|vuvuzela|väikekannel|Wagner tuba|wah-wah|wah-wah pedal|wah-wah tube|walaycho|waldzither|walkie-talkie|wankara|wardrobe stylist|Warr Guitar|washboard|washint|washtub bass|wassakhoumba|water drums|water flute|watercolor|Waterphone|Wavedrum|website staff|Weissenborn|Welsh bagpipes|Western concert flute|whip|whirligig|whirling aerophones|whistle|whistling|white noise|willow flute|wind chimes|wind controller|wind gong|wind machine|wind wand|winds|wine glasses|wire viola|wobble board|wolgeum|wood blocks|wood chimes|wood flute|wooden frog|wooden horn trumpet|Woodrow|woodwind arrangements|woodwinds|wrench|writer|Wurlitzer|Xaphoon|xeremia|xiao|xiaoruan|xirula|xomus|xun|xylophone|Xylosynth|yakumo-goto|yanggeum|yangqin|yatga|yaylı tanbur|yehu|yelling|yodeling|yokobue|yoochin|yotsutake|yu|yueqin|yunluo|zabumba|zabumbateria|zambomba|zampogna|zampoña|zapateado|zena|zerbaghali|Zetland pipes|zeze|zhaleika|zhonghu|zhongruan|zhu|zhuxian|zither|Zube Tube|zuffolo|zukra|zurna|złóbcoki|çeng|çifteli|çöğür saz|çığırtma|épinette des Vosges|üçtelli sazı|čelović|đàn bầu|đàn gáo|đàn môi|đàn nguyệt|đàn nhị|đàn sến|đàn t\'rưng|đàn ta lư|đàn tam|đàn tam thập lục|đàn tranh|đàn tính|đàn tứ|đàn tỳ bà|đàn đáy|ģīga|ōdaiko|ōtsuzumi|šupelka|ūžynė'.split('|').map((x) => [x.toLowerCase(), x]));
  // ruoli Discogs (senza "By") -> ruoli Rym, quando il nome è diverso
  const ROLE_MAP = { 'mastered': 'mastering engineer', 'mastering': 'mastering engineer', 'remastered': 'remastering engineer', 'remastering': 'remastering engineer', 'lacquer cut': 'cutting engineer', 'cut': 'cutting engineer', 'dmm cut': 'direct metal mastering', 'mixed': 'mixing engineer', 'mixing': 'mixing engineer', 'mix': 'mixing engineer', 'assistant mixed': 'mixing assistant', 'additional mixed': 'additional mixing engineer', 'recorded': 'recording engineer', 'recording': 'recording engineer', 'engineered': 'engineer', 'assistant engineered': 'assistant engineer', 'remix': 'remixer', 'remixed': 'remixer', 'featuring': 'featured', 'voice': 'vocals', 'vocal': 'vocals', 'guest vocals': 'vocals', 'programmed': 'programming', 'arranged': 'arranger', 'arrangement': 'arranger', 'orchestrated': 'arranger', 'written': 'songwriter', 'songwriter': 'songwriter', 'lyrics': 'lyricist', 'words': 'lyricist', 'text': 'lyricist', 'libretto': 'librettist', 'music': 'composer', 'composed': 'composer', 'composition': 'composer', 'score': 'composer', 'artwork': 'art', 'cover': 'cover art', 'cover artwork': 'cover art', 'photo': 'photography', 'photographs': 'photography', 'paintings': 'painting', 'designed': 'design', 'sleeve design': 'sleeve design', 'illustrated': 'illustration', 'layout': 'layout', 'dj mix': 'DJ mixing', 'mixed dj': 'DJ mixing', 'turntables': 'turntable', 'scratches': 'scratching', 'turntablism': 'scratching', 'edited': 'editing', 'edit': 'editing', 'compiled': 'compiler', 'compilation': 'compiler', 'hosted': 'host', 'presented': 'presenter', 'directed': 'director', 'film director': 'director', 'narrator': 'narration', 'narrated': 'narration', 'translated': 'translator', 'translation': 'translator', 'notes': 'liner notes', 'a&r': 'artists and repertoire', 'management': 'manager', 'managed': 'manager', 'sound design': 'sound designer', 'upright bass': 'double bass', 'contrabass': 'double bass', 'acoustic bass': 'double bass', 'lap steel guitar': 'lap steel', 'shaker': 'shakers', 'beatbox': 'beat box', 'human beatbox': 'beat box', 'all instruments': 'instruments', 'synth': 'synthesizer', 'synthesizers': 'synthesizer', 'keyboard': 'keyboards', 'samples': 'sampling', 'field recording': 'field recordings', 'tape': 'tapes', 'post production': 'post-production', 'band leader': 'leader', 'bandleader': 'leader', 'choir master': 'choirmaster', 'chorus master': 'choirmaster', 'executive-producer': 'executive producer', 'producer [executive]': 'executive producer', 'additional production': 'additional producer', 'co-produced': 'co-producer', 'produced': 'producer', 'liner notes': 'liner notes', 'spoken word': 'spoken word', 'speech': 'spoken word', 'mc': 'MC', 'emcee': 'MC', 'rapper': 'rap', 'handclaps': 'handclaps', 'claps': 'handclaps' };
  const unknownRoles = new Set();
  function rymRole(r) {
    const x = (r || '').replace(/\[\s*uncredited\s*\]/i, '').replace(/\s+/g, ' ').trim();
    if (!x) return '';
    const norm = (t) => t.toLowerCase().replace(/[\s-]by$/, '').trim();
    const find = (t) => { const k = norm(t); const a = ROLE_MAP[k] || k; return RYM_ROLES.get(a.toLowerCase()) || null; };
    // "Vocals [Backing]" -> "backing vocals", "Engineer [Mastering]" -> "mastering engineer"
    const br = x.match(/^(.*?)\s*\[([^\]]+)\]$/);
    const cands = [];
    if (br) {
      const base = norm(br[1]);
      br[2].split(',').map((d) => d.trim().toLowerCase()).filter(Boolean).forEach((d) => { cands.push(d + ' ' + base, d + ' ' + (ROLE_MAP[base] || base), d); });
      cands.push(br[1]);
    } else cands.push(x);
    for (const c of cands) { const f = find(c); if (f) return f; }
    const k = norm(br ? br[1] : x);
    unknownRoles.add(k);
    return k;
  }
  // tracce Discogs ("A1 to B3, B5") -> Rym: intervalli con "-" che non attraversano lati o dischi (wiki §18.3)
  function rymTracks(spec, T) {
    if (!spec) return '';
    const rows = T.tracks.filter((t) => !t.header);
    const key = (p) => String(p || '').trim().toUpperCase().replace(/\.$/, '');
    const idx = new Map();
    rows.forEach((t, i) => { if (!idx.has(key(t.orig))) idx.set(key(t.orig), i); });
    const picked = new Set();
    let ok = true;
    spec.split(/\s*,\s*/).forEach((part) => {
      const r = part.split(/\s+to\s+/i);
      const a = idx.get(key(r[0])), b = r.length > 1 ? idx.get(key(r[1])) : a;
      if (a == null || b == null) { ok = false; return; }
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) picked.add(i);
    });
    if (!ok || !picked.size) return spec.replace(/\s+to\s+/gi, '-');
    const unit = (p) => (String(p).match(/^([A-Z]+|\d+(?=\.))/) || [''])[0];
    const list = [...picked].sort((x, y) => x - y);
    const out = [];
    let start = null, prev = null;
    const span = (a, b) => (a === b ? rows[a].pos : rows[a].pos + '-' + rows[b].pos);
    list.forEach((i) => {
      if (start != null && i === prev + 1 && unit(rows[i].pos) === unit(rows[start].pos)) { prev = i; return; }
      if (start != null) out.push(span(start, prev));
      start = prev = i;
    });
    if (start != null) out.push(span(start, prev));
    return out.join(', ');
  }
  function creditLines(T) {
    unknownRoles.clear();
    const groups = new Map(), special = new Map();
    const addSpecial = (name, role, tracks) => {
      String(name).split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean).forEach((n) => {
        const k = n.toLowerCase() + '|' + role;
        if (!special.has(k)) special.set(k, { name: n, roles: [role], tracks: [], all: false });
        const x = special.get(k);
        if (tracks) x.tracks.push(tracks); else x.all = true;
      });
    };
    (D.creditList || []).forEach((c) => {
      // classica: i crediti di composizione vanno sulle opere, non sulla release
      if (D.classical && /composed by|composer|written-by|lyrics by|libretto|arranged by|music by/i.test(c.role)) return;
      const tracks = rymTracks(c.tracks, T);
      c.role.split(/,\s*(?![^\[]*\])/).forEach((r) => {
        const role = rymRole(r);
        if (!role) return;
        if (role === 'featured' || role === 'guest') return addSpecial(c.name, role, tracks);
        const k = c.name.toLowerCase() + '|' + tracks;
        if (!groups.has(k)) groups.set(k, { name: c.name, roles: [], tracks });
        const g = groups.get(k);
        if (!g.roles.includes(role)) g.roles.push(role);
      });
    });
    T.featured.forEach((f) => addSpecial(f.who, 'featured', f.pos));
    T.guests.forEach((g) => addSpecial(g.who, 'guest', g.pos));
    const R = releaseMode();
    R.featured.forEach((n) => addSpecial(n, 'featured', ''));
    R.guests.forEach((n) => addSpecial(n, 'guest', ''));
    return [...groups.values()].concat([...special.values()].map((x) => ({ name: x.name, roles: x.roles, tracks: x.all ? '' : [...new Set(x.tracks)].join(', ') })));
  }
  // Righe di credito in testo semplice; 🔍 cerca l'artista e, cliccando il risultato, la riga diventa collegata
  let pendingLink = null, creditObs = null;
  function addCreditLines(lines) {
    if (typeof W.addCredit !== 'function') return toast(say('Funzione crediti di Rym non trovata.', 'Rym credits function not found.'), false);
    lines.forEach((ln) => {
      try { W.addCredit(0, 'XXX', ''); } catch (e) { return; }
      const n = W.credits_num;
      const a = document.getElementById('credits_artist_' + n);
      if (!a) return;
      setVal(a, ln.name);
      setVal(document.getElementById('credits_roles_' + n), ln.roles.join(', '));
      setVal(document.getElementById('credits_tracks_' + n), ln.tracks);
      touched.credits.push(n);
      const li = document.getElementById('credits_' + n);
      if (li) {
        const s = document.createElement('a');
        s.href = 'javascript:void(0)'; s.textContent = ' 🔍'; s.title = say('Cerca e collega l\'artista', 'Search and link the artist');
        s.addEventListener('click', () => {
          pendingLink = n;
          setVal($('#credit_searchterm'), ln.name);
          const fr = $('#creditlist'); // stessa URL di searchCredits() di Rym / same URL as Rym's searchCredits()
          if (fr) fr.src = '/go/searchcredits?searchterm=' + encodeURIComponent(ln.name);
        });
        (li.querySelector('.credits_artist') || li).appendChild(s);
      }
    });
    watchCreditLinks();
    toast(say('Crediti aggiunti: ', 'Credits added: ') + lines.length);
  }
  function watchCreditLinks() {
    const ul = $('#creditsx');
    if (!ul || creditObs) return;
    creditObs = new MutationObserver(() => {
      if (pendingLink == null) return;
      const n = W.credits_num;
      const a = document.getElementById('credits_artist_' + n);
      if (!a || n === pendingLink || !/^\[Artist\d+\]$/.test(a.value)) return;
      // il credito collegato prende ruoli e tracce della riga in testo, che viene tolta
      setVal(document.getElementById('credits_roles_' + n), (document.getElementById('credits_roles_' + pendingLink) || {}).value || '');
      setVal(document.getElementById('credits_tracks_' + n), (document.getElementById('credits_tracks_' + pendingLink) || {}).value || '');
      try { W.deleteCredit(pendingLink); } catch (e) { /* - */ }
      touched.credits = touched.credits.filter((x) => x !== pendingLink).concat([n]);
      pendingLink = null;
    });
    creditObs.observe(ul, { childList: true });
  }

  // Edizione fisica venduta su Bandcamp: la stessa release diventa un'issue fisica
  function applyPhysical(p) {
    const txt = [p.name, p.type, p.desc].filter(Boolean).join(', ');
    const fmtName = p.format || (/vinyl|\blp\b|record|7"|10"|12"/i.test(txt) ? 'Vinyl' : /cassette|tape/i.test(txt) ? 'Cassette' : /\bcd\b|compact disc/i.test(txt) ? 'CD' : '');
    if (!fmtName) return toast(say('Formato dell\'edizione non riconosciuto.', 'Edition format not recognised.'), false);
    const descs = [];
    const sz = txt.match(/\b(7|10|12)\s*(?:"|''|”|-?inch\b|in\b)/i);
    if (fmtName === 'Vinyl') { if (sz) descs.push(sz[1] + '"'); else if (/\blp\b/i.test(txt)) descs.push('LP'); }
    if (/\blimited\b/i.test(txt) || p.edition) descs.push('Limited Edition');
    if (/\bnumbered\b/i.test(txt)) descs.push('Numbered');
    const [y, m, d] = (p.date || '').split('-');
    D = Object.assign({}, D, {
      formatName: fmtName, descriptions: descs, formatTexts: [txt], vinylTexts: fmtName === 'Vinyl' ? [p.desc || p.name] : [],
      lossless: false, streaming: false, streamingOnly: false, downloadUnknown: false, noArt: false,
      labels: (D.labels || []).map((l) => Object.assign({}, l, { catno: p.catno || '', noCat: !p.catno })),
      year: y || D.year, month: y ? (m || '') : D.month, day: y ? (d || '') : D.day,
      country: countryFromLocation(D.labelLocation), physicalApplied: true, oldDate: '', lateUpload: false, pubDate: ''
    });
    renderPanel();
    fill();
  }

  // ---- logica di compilazione ----
  function fill() {
    if (loadData()) renderPanel(); // usa sempre l'ultima release salvata
    if (!D) return;
    if (filledRaw) resetForm();    // via i dati della compilazione precedente
    const log = [];                // dettagli (sezione chiusa)
    const warn = [];               // dettagli (sezione chiusa)
    const sum = [];                // riga verde: cosa è stato compilato
    const todo = [];               // in vista: solo ciò che richiede un intervento
    const desc = D.descriptions || [];
    const mdesc = mainDesc();
    const T = prepare();           // titolo e tracce con le maiuscole Rym
    const RM = releaseMode();
    // pulsanti "applica" mostrati sotto il riepilogo
    const actions = [];
    const act = (label, run, color) => actions.push({ label, run, color });
    const primary = !$('#parent_id') || $('#parent_id').value === '0';

    const other = artistMismatch();
    if (other) {
      warn.push('ATTENZIONE: questa pagina è dell\'artista "' + other + '", la release è di "' + D.artist + '". Apri la pagina Add release giusta.');
      todo.push('Pagina di un altro artista ("' + other + '"): apri l\'Add release di "' + D.artist + '"');
    }

    // 1.2 Categoria e 1.3 File under (wiki "Add a release": V/A con 5+ artisti, split con 2-4, collaborazioni)
    const filedAlready = !!form.querySelector('input[id^="filed_under_performer_artist_"]');
    const djNames = (D.creditList || []).filter((c) => /^dj mix/i.test(c.role) && !c.tracks).map((c) => c.name);
    const hosts = [...new Set((D.creditList || []).filter((c) => /\bhost(ed)?\b/i.test(c.role)).map((c) => c.name))];
    if (D.classical) {
      clickRadio('category', 'classical');
      clickRadio('collab_type', 'not_applicable');
      log.push(say('Categoria: Classical music release', 'Category: Classical music release'));
      sum.push(say('Classica', 'Classical'));
      // ordine della wiki: orchestra, coro/ensemble, direttore, solisti
      const rank = (p) => (/orchestra|philharmoni|symphon/i.test(p) ? 0 : /choir|chorus|ensemble|quartet|trio|consort|chor\b/i.test(p) ? 1 : /conductor/i.test(p) ? 2 : 3);
      const perfs = [...new Set([...(D.performers || [])].sort((a, b) => rank(a) - rank(b)).map((p) => p.replace(/\s*\([^)]*\)$/, '')))];
      todo.push(say('File under agli interpreti, in quest\'ordine: orchestra, coro, direttore, solisti', 'File under the performers, in this order: orchestra, choir, conductor, soloists') + (perfs.length ? ': ' + perfs.slice(0, 4).join(', ') : ''));
      warn.push(say('Classica: il "file under" va agli interpreti, non ai compositori. Collega i brani alle opere ([WorkXXXX]) come da wiki "Classical music".',
        'Classical: "file under" goes to the performers, not the composers. Link the tracks to the works ([WorkXXXX]) as per the "Classical music" wiki.'));
      if ((D.performers || []).length) warn.push(say('Interpreti su Discogs: ', 'Performers on Discogs: ') + D.performers.join(', ') + '.');
      if (!filedAlready && perfs.length) searchPerformer(perfs[0]);
      perfs.slice(filedAlready ? 0 : 1, 6).forEach((p) => act(say('Cerca interprete: ', 'Search performer: ') + p, () => searchPerformer(p), '#2a6fdb'));
      // compositori ("File under composer"): solo chi ha scritto almeno il 25% della release
      const comps = [...new Set((D.creditList || []).filter((c) => /composed by|^composer|written-by|music by/i.test(c.role)).map((c) => c.name))];
      if (comps.length) {
        todo.push(say('Compositori in "File under composer" (almeno 25% della release): ', 'Composers in "File under composer" (at least 25% of the release): ') + comps.slice(0, 4).join(', '));
        comps.slice(0, 6).forEach((c) => act(say('Cerca compositore: ', 'Search composer: ') + c, () => searchComposer(c), '#2a6fdb'));
      }
      // titolo: i nomi degli interpreti staccati dal titolo vanno tolti
      const perfName = perfs.find((p) => new RegExp('[(\\[-–:]\\s*' + escRe(p) + '\\s*[)\\]]?\\s*$', 'i').test(T.title));
      if (perfName) {
        const cut = T.title.replace(new RegExp('\\s*[(\\[-–:]\\s*' + escRe(perfName) + '\\s*[)\\]]?\\s*$', 'i'), '').trim();
        if (cut) act(say('Titolo senza l\'interprete: ', 'Title without the performer: ') + cut, () => setVal($('#title'), cut), '#8e44ad');
      }
      warn.push(say('Classica: nel titolo separa con ";" le opere dello stesso compositore e con "/" quelle di compositori diversi.', 'Classical: in the title separate works by the same composer with ";" and works by different composers with "/".'));
    } else if (D.various && mdesc.includes('Mixed') && djNames.length) {
      // DJ mix: va sotto il DJ, non sotto Various Artists, se la release è accreditata a lui
      if (!filedAlready) searchPerformer(djNames[0]);
      djNames.slice(filedAlready ? 0 : 1).forEach((n) => act(say('Cerca: ', 'Search: ') + n, () => searchPerformer(n), '#2a6fdb'));
      log.push('DJ Mix: file under ' + djNames.join(', '));
      todo.push(say('DJ Mix: file under al DJ (', 'DJ Mix: file under the DJ (') + djNames.join(', ') + say(') solo se la release è accreditata a lui, altrimenti Various Artists', ') only if the release is credited to them, otherwise Various Artists'));
      act(say('Usa Various Artists', 'Use Various Artists'), () => clickRadio('category', 'va'), '#555');
    } else if (RM.mode === 'va') {
      clickRadio('category', 'va');
      log.push(say('Categoria: Various Artists', 'Category: Various Artists') + (RM.distinct.length ? ' (' + RM.distinct.length + say(' artisti', ' artists') + ')' : ''));
      sum.push('V/A');
      warn.push(say('V/A: collega gli artisti nella tracklist con "Insert link to artist".', 'V/A: link the artists in the tracklist with "Insert link to artist".'));
    } else {
      const names = RM.fileUnder.length ? RM.fileUnder : [D.artistSearch].filter(Boolean);
      if (RM.mode === 'split') {
        clickRadio('collab_type', 'split');
        log.push(say('Split: ', 'Split: ') + names.join(' / '));
        sum.push('Split');
        warn.push(say('Split: file under a ogni artista nell\'ordine della release, tutti con "Credited name"; ogni traccia "Artista - Titolo" (collega gli artisti).',
          'Split: file under each artist in the order of the release, all with "Credited name"; every track "Artist - Title" (link the artists).'));
      } else if (RM.mode === 'collab') {
        clickRadio('collab_type', 'collab');
        log.push(say('Collaborazione: ', 'Collaboration: ') + names.join(' & '));
        warn.push(say('Collaborazione: se esiste un profilo per "', 'Collaboration: if a profile for "') + names.join(' & ') +
          say('" va nel file under (accreditato) e i singoli artisti senza "Credited name". Altrimenti solo i singoli artisti.', '" exists, file it (credited) and the single artists without "Credited name". Otherwise only the single artists.'));
        const collabName = names.join(' & ');
        act(say('Cerca il profilo "', 'Search the profile "') + collabName + '"', () => searchPerformer(collabName), '#2a6fdb');
      }
      if (!filedAlready && names.length) {
        searchPerformer(names[0]);
        warn.push(say('Artista non impostato: scegli "', 'Artist not set: pick "') + names[0] + say('" dai risultati a destra (1.3a).', '" from the results on the right (1.3a).'));
        todo.push(say('Scegli l\'artista "', 'Pick the artist "') + names[0] + say('" a destra (1.3a)', '" on the right (1.3a)') + (names.length > 1 ? say(', poi: ', ', then: ') + names.slice(1).join(', ') : ''));
      }
      names.slice(filedAlready ? 0 : 1).forEach((n) => act(say('Cerca: ', 'Search: ') + n, () => searchPerformer(n), '#2a6fdb'));
      // 1.4 nome accreditato: con "feat."/"with" o una variante del nome (ANV)
      const anvDiff = (D.artistsList || []).some((a) => a.anv && norm(a.anv) !== norm(a.name));
      if (RM.featured.length || RM.guests.length || anvDiff) {
        const credited = creditedString();
        act(say('Nome accreditato: ', 'Credited name: ') + credited, () => setCreditedName(credited), '#8e44ad');
        todo.push(say('Nome accreditato diverso dal default (feat./with o variante del nome): pulsante sotto', 'Credited name differs from the default (feat./with or a name variation): button below'));
      }
      if (RM.featured.length || RM.guests.length) warn.push(say('"feat."/"with" nell\'artista: niente file under per ', '"feat."/"with" in the artist: no file under for ') + RM.featured.concat(RM.guests).join(', ') + say(', solo crediti featured/guest.', ', only featured/guest credits.'));
    }
    if (hosts.length) warn.push(say('Mixtape: gli host (', 'Mixtape: hosts (') + hosts.join(', ') + say(') vanno solo nei crediti, mai nel file under.', ') only go in the credits, never in file under.'));

    // formato e misura servono già per stimare il tipo
    let fmt = FORMAT[D.formatName];
    // Rym: Digital File oppure Lossless Digital, mai entrambi; preferire la qualità più alta
    if (/^(File|Memory Stick|Floppy Disk)$/.test(D.formatName) && (D.lossless || desc.some((x) => /^(FLAC|WAV|ALAC|AIFF?C?|APE|DSF|DFF|WavPack|SHN|TTA)$/i.test(x)))) fmt = 59;
    // varianti indicate nelle descrizioni Discogs: DVD-Audio, HDCD
    if (fmt === 78 && desc.includes('DVD-Audio')) fmt = 77;
    if (fmt === 60 && desc.includes('HDCD')) fmt = 83;
    const digital = fmt === 58 || fmt === 59;
    let size = Object.keys(DISC_SIZE).find((k) => mdesc.includes(k));
    if (!size && fmt === 95 && mdesc.includes('LP')) size = '12"';
    // misure non standard (6½", 5½", 3½", 2", 1")
    const oddSize = !size && mdesc.find((x) => /^(6½|5½|3½|2|1|14|13|15)"$/.test(x));
    // dischi ottici: la misura si indica solo se diversa dallo standard (es. 3" CD)
    if (size === '5"' && OPTICAL_ALL.includes(fmt)) size = undefined;

    // 1.5 Tipo release (+ attributi di performance, che possono spostarlo in "Additional releases")
    let G = guessType(fmt, size);
    const P = perfAttrs(T, G.type);
    if (P.additional && G.type !== 'b') G = { type: 'x', reason: 'contenuti ' + P.attrs.filter((a) => ADDITIONAL.some((x) => x[1] === a[1]) || a[0] === 132 || a[0] === 18).map((a) => a[1]).join(', '), sure: false };
    clickRadio('type', G.type);
    log.push('Tipo: ' + TYPE_NAME[G.type] + ' (' + G.reason + ')');
    sum.push(TYPE_NAME[G.type] + (G.sure ? '' : '?'));
    if (G.unknown) { warn.push('Nessuna tracklist né indizi dal formato: tipo NON stimabile, sceglilo tu (1.5).'); todo.push('Scegli il tipo di release (1.5)'); }
    else if (!G.sure) { warn.push('Tipo stimato (' + G.reason + '): verificalo (1.5). Per Rym conta ciò che dichiarano artista o etichetta.'); todo.push('Tipo stimato: ' + TYPE_NAME[G.type] + ' (' + G.reason + ')'); }
    if (!G.sure && !G.unknown && /durata ignota|oltre/.test(G.reason)) warn.push('Durate mancanti o parziali: la stima si basa soprattutto sul numero di tracce.');
    if (G.type === 'c' && D.various) warn.push('Compilation V/A: per Rym è compilation solo se oltre il 50% è già uscito. Se è materiale inedito usa Standard Album.');
    if (G.type === 'j') warn.push('DJ Mix solo se la release è accreditata al DJ che l\'ha mixata.');
    if (G.type === 'd' || G.type === 'o') {
      warn.push(say('Video: solo uscite ufficiali (niente bootleg video). Un concerto o una raccolta di videoclip = Video; un videoclip di un solo brano = Music video.',
        'Video: official releases only (no bootleg videos). A concert or a music video collection = Video; a single-song music video = Music video.'));
      if (desc.includes('Unofficial Release')) todo.push(say('Video non ufficiale: Rym non accetta video bootleg', 'Unofficial video: Rym does not accept bootleg videos'));
    }
    if (G.type === 'i' && size === '12"' && D.year && +D.year < 1976) warn.push(say('I 12" singoli non esistevano prima del 1976: probabile EP o album.', '12" singles did not exist before 1976: probably an EP or an album.'));
    if (oddSize) { clickRadio('disc_size', 99); log.push(say('Disco: misura non standard ', 'Disc: non-standard size ') + oddSize); }

    // Titolo standard Rym per i singoli (solo formati fisici: per il digitale vale la pagina "Digital singles")
    let suggested = '';
    if (G.type === 'i' && !digital) {
      suggested = singleTitle(T.tracks);
      if (suggested && suggested.toLowerCase() !== (T.title || '').toLowerCase()) {
        warn.push('Titolo standard Rym per il singolo: "' + suggested + '" (usa il pulsante sotto per applicarlo).');
        todo.push('Titolo Rym per il singolo: "' + suggested + '" (pulsante sotto)');
      } else suggested = '';
    }

    // 1.6 Data
    // data plausibile per il formato (es. nessun CD prima del 1982, nessuna issue digitale prima del 2000)
    let year = D.year;
    if (fmt && FORMAT_YEAR[fmt] && year && +year < FORMAT_YEAR[fmt]) {
      if (digital) {
        warn.push(say('Data digitale ' + year + ' prima del 2000: per Rym non è affidabile, lasciata vuota (wiki "Digital releases" §3).', 'Digital date ' + year + ' before 2000: not reliable for Rym, left blank (wiki "Digital releases" §3).'));
        todo.push(say('Data digitale lasciata vuota (prima del 2000): cerca quando è uscita davvero in digitale', 'Digital date left blank (before 2000): find when it really came out digitally'));
        year = '';
      } else {
        warn.push(say('Anno ' + year + ' strano per il formato ' + D.formatName + ' (prima del ' + FORMAT_YEAR[fmt] + '): controlla data o formato.', 'Year ' + year + ' is odd for the ' + D.formatName + ' format (before ' + FORMAT_YEAR[fmt] + '): check the date or the format.'));
        todo.push(say('Controlla anno e formato (', 'Check year and format (') + year + ', ' + D.formatName + ')');
      }
    }
    if (setSelect('year', year)) { const dd = [year, D.month, D.day].filter(Boolean).join('-'); log.push(say('Data: ', 'Date: ') + dd); sum.push(dd); }
    else { warn.push(say('Anno non impostato.', 'Year not set.')); todo.push(say('Data mancante', 'Date missing')); }
    if (year) { setSelect('month', D.month); setSelect('day', D.day); }
    // Discogs a volte usa l'anno del © come data: Rym non lo accetta (wiki "Add release information" §6)
    const cYears = [...(D.notes || '').matchAll(/[©℗]\s*(?:copyright\s*)?((?:19|20)\d\d)/gi)].map((m) => m[1]);
    if (year && !D.month && cYears.includes(year)) warn.push(say('Solo l\'anno, uguale a quello del ©/℗: potrebbe essere la data di copyright, non di uscita. Verifica.', 'Year only, the same as the ©/℗ year: it may be the copyright date, not the release date. Check it.'));
    // Bandcamp: la data di uscita la sceglie l'artista, quella di pubblicazione dice quando l'album è comparso
    if (SRC === 'Bandcamp' && D.pubDate && (D.oldDate || D.lateUpload)) {
      const setDate = (iso) => { const [y, m, d] = iso.split('-'); setSelect('year', y); setSelect('month', m); setSelect('day', d); };
      act(say('Usa la data di pubblicazione ', 'Use the publish date ') + D.pubDate, () => setDate(D.pubDate), '#2a6fdb');
      if (D.relDate && !D.oldDate) act(say('Usa la data di uscita ', 'Use the release date ') + D.relDate, () => setDate(D.relDate), '#555');
      todo.push(say('Bandcamp: uscita ', 'Bandcamp: released ') + (D.relDate || D.oldDate) + say(', pubblicata ', ', published ') + D.pubDate +
        say('. Se è una ristampa digitale di un disco più vecchio, la data dell\'issue digitale è quando è comparsa in digitale.', '. If it is a digital reissue of an older record, the digital issue date is when it first appeared digitally.'));
    }
    if (D.preorder) warn.push(say('Pre-order: su Rym le uscite future vanno solo se annunciate con titolo e data (anno in corso o prossimo).', 'Pre-order: on Rym upcoming releases are allowed only when announced with title and date (this year or next).'));
    if (D.partOfAlbum) { warn.push(say('Questa traccia fa parte di un album: non è un singolo a sé, salvo che sia uscita anche come singolo.', 'This track belongs to an album: it is not a standalone single, unless it was also released as a single.')); todo.push(say('Traccia di un album: verifica che esista come singolo', 'Track from an album: check it exists as a single')); }
    if (SRC === 'Bandcamp') warn.push('La data Bandcamp a volte è quella di caricamento: verificala.');
    if (SRC === 'Bandcamp' && D.physicalApplied) warn.push(say('Edizione fisica da Bandcamp: data, etichetta, catalogo e paese vanno verificati sul disco.', 'Physical edition from Bandcamp: date, label, catalog number and country need checking on the item.'));

    // 2.1 Titolo (+ esito della correzione maiuscole)
    if (setVal($('#title'), T.title)) log.push('Titolo');
    if (T.titleEn && setVal($('#title_en'), T.titleEn)) { touched.fields.add('title_en'); }
    log.push(...T.log);
    warn.push(...T.warn);

    // 3.1 Formato
    if (fmt && clickRadio('format', fmt)) {
      log.push('Formato: ' + (digital ? 'Digital File' : D.formatName));
      sum.push((digital ? (fmt === 59 ? 'Lossless Digital' : 'Digital File') : D.formatName) + (size ? ' ' + size : ''));
    } else { warn.push('Formato "' + D.formatName + '" non mappato: sceglilo a mano.'); todo.push('Scegli il formato (3.1)'); }

    if (digital) {
      // Bandcamp: di norma sia "Digital file" sia "Streaming"; solo Streaming se non scaricabile
      const dist = [];
      if (!D.streamingOnly && check('attrib122')) dist.push('Digital file');
      if (D.streaming && check('attrib123')) dist.push('Streaming');
      if (dist.length) log.push('Distribuzione: ' + dist.join(' + '));
      if (D.streamingOnly) warn.push('Sembra disponibile solo in streaming: impostati Digital File + solo "Streaming". Verifica.');
      if (D.downloadUnknown) warn.push('Non so se è scaricabile: se è solo in streaming togli "Digital file" e usa Digital File invece di Lossless.');
    }
    if (D.oldDate) {
      warn.push('Bandcamp indica ' + D.oldDate + ': è la data originale, non quella dell\'uscita digitale. Rym la vuole vuota se non c\'è una fonte affidabile. Probabile issue secondaria (1.1).');
      todo.push('Data originale ' + D.oldDate + ' non usata: probabile issue secondaria (1.1)');
    }

    // 3.2 Disc size (obbligatorio per vinile; per i CD solo se non standard)
    if (size) { clickRadio('disc_size', DISC_SIZE[size]); log.push('Disco: ' + size); }
    else if (fmt === 95) { warn.push('Vinile senza misura: imposta Disc size (3.2).'); todo.push('Imposta Disc size (3.2)'); }

    // 3.3 / 3.4 Etichetta e catalogo (wiki "Catalog numbers")
    //  - senza etichetta: label "(No Label)" e catalogo "n/a" (se Discogs non indica un numero)
    //  - fisico con etichetta ma senza numero: "n/a"
    //  - digitale con etichetta ma senza numero: vuoto
    const pick = pickLabel(D.labels || []);
    const lab = pick.lab;
    if (pick.distributor) todo.push(say('«' + lab.name + '» è un distributore digitale, non un\'etichetta: su Rym probabilmente "(No Label)"', '«' + lab.name + '» is a digital distributor, not a label: on Rym probably "(No Label)"'));
    if (pick.skipped.length) log.push(say('Etichette saltate (gruppo o distributore; Rym vuole la più specifica): ', 'Labels skipped (group or distributor; Rym wants the most specific one): ') + pick.skipped.join(', '));
    const noLabel = (lab && /^not on label/i.test(lab.name)) || (!lab && D.selfReleased);
    const labelSearch = noLabel ? 'No Label' : (lab ? lab.name : '');
    if (labelSearch) {
      setVal($('#searchterm'), labelSearch);
      const lf = $('#labellist'); // stessa URL usata da searchLabels() di Rym
      if (lf) lf.src = '/go/search?searchtype=b&searchterm=' + encodeURIComponent(labelSearch);
    }
    let catno = lab ? lab.catno : '';
    if (noLabel && !catno) catno = 'n/a'; // senza etichetta: "n/a" solo se non c'è un numero di catalogo
    else if (lab && !catno && lab.noCat && !digital) catno = 'n/a';
    // cose che non sono numeri di catalogo (wiki "Catalog numbers" §8)
    const bad = badCatno(catno, lab && lab.name);
    if (bad) {
      warn.push(say('Numero di catalogo «', 'Catalog number «') + catno + say('» scartato: sembra ', '» dropped: it looks like ') + bad + '.');
      todo.push(say('Catalogo da verificare sulla costa (Discogs dà «', 'Catalog # to check on the spine (Discogs gives «') + catno + '»: ' + bad + ')');
      catno = '';
    }
    const sameLabel = (D.labels || []).filter((l) => lab && l.name === lab.name && l.catno && l.catno !== lab.catno);
    if (sameLabel.length) todo.push(say('Discogs ha più numeri di catalogo per ', 'Discogs has several catalog numbers for ') + lab.name + ' (' + [lab.catno].concat(sameLabel.map((l) => l.catno)).join(', ') + say('): usa quello sulla costa', '): use the one on the spine'));
    if (setVal($('#catalog_no'), catno)) { log.push('Catalogo: ' + catno); sum.push('cat. ' + catno); }
    // V/A: il classifier di etichetta ([LabelXXXX]) è obbligatorio: si compila appena scegli l'etichetta
    if (radioVal('category') === 'va') {
      todo.push(say('V/A: dopo aver scelto l\'etichetta, il campo "Label(s)" dei classifier si compila da solo', 'V/A: after you pick the label, the classifiers "Label(s)" field fills in by itself'));
      watchVaLabel();
      if ((D.series || []).length) todo.push(say('Serie su Discogs: ', 'Series on Discogs: ') + D.series.join(', ') + say(' → cerca il classifier ([DescriptorXXXX]) con "open list"', ' → look up the classifier ([DescriptorXXXX]) with "open list"'));
      const trib = (D.title || '').match(/\btribute to\s+(.+?)\s*$/i);
      if (trib) todo.push(say('Tributo: in "Tribute(s)" metti il link [ArtistXXXX] di ', 'Tribute: in "Tribute(s)" put the [ArtistXXXX] link of ') + trib[1]);
    }
    if (noLabel) warn.push('Senza etichetta' + (SRC === 'Bandcamp' ? ' (probabile autoproduzione)' : '') + ': scegli "(No Label)" nei risultati a destra (3.3).');
    else if (lab) warn.push('Etichetta: clicca "' + lab.name + '" nei risultati a destra (3.3).');

    // Release senza titolo ("Untitled" su Discogs), esclusi i singoli (per loro vale il titolo dai brani):
    // la wiki Rym dice self-titled (nome dell'artista); in alternativa si propone il numero di catalogo.
    const suggestions = suggested ? [suggested] : [];
    const firstTrack = (T.tracks.find((t) => !t.header) || {});
    if (/^\[?(untitled|s\/t|self[\s-]?titled)\]?$/i.test((D.title || '').trim()) && G.type !== 'i') {
      if (D.artist && !D.various) suggestions.push(RM.mode === 'split' ? RM.fileUnder.join(' / ') : D.artist);
      // EP di 4 tracce senza titolo: titolo dalla costa, se no la traccia in evidenza, se no la A1 (wiki "Release types" §2.1)
      if (G.type === 'e' && T.tracks.filter((t) => !t.header).length === 4 && firstTrack.title) suggestions.push(firstTrack.plain || firstTrack.title);
      if (catno && catno !== 'n/a') suggestions.push(catno);
      if (suggestions.length) todo.push('Release senza titolo: per la wiki Rym è self-titled (nome dell\'artista); scegli sotto');
    }

    // split senza titolo vero: il titolo è l'elenco degli artisti come nel nome (wiki §8.5)
    if (RM.mode === 'split' && G.type !== 'i' && / \/ /.test(D.title || '') && RM.fileUnder.length) {
      suggestions.push(RM.fileUnder.join(' / '));
      todo.push(say('Split: se la release non ha un titolo vero, il titolo è l\'elenco degli artisti (pulsante sotto)', 'Split: if the release has no real title, the title is the list of artists (button below)'));
    }
    // varianti di colore: "[blue marble vinyl]" in minuscolo nel titolo, solo se esistono più colori della stessa issue
    const brag = colorBrag(fmt);
    if (brag) {
      suggestions.push(T.title + ' ' + brag);
      todo.push(say('Più colori della stessa issue? Allora aggiungi ', 'Several colours of the same issue? Then add ') + brag + say(' al titolo (pulsante sotto)', ' to the title (button below)'));
    }
    // Edition name: solo testo stampato sulla release, solo per le issue secondarie (wiki §9)
    const ed = findEdition(T.title, D.formatTexts || []);
    if (ed) {
      act('Edition name: ' + ed.name + (ed.inTitle ? say(' (togli dal titolo)', ' (remove from the title)') : ''), () => {
        setVal($('#addendum'), ed.name); touched.fields.add('addendum');
        if (ed.inTitle) setVal($('#title'), ed.cutTitle);
      }, '#8e44ad');
      todo.push(say('Edition name «', 'Edition name «') + ed.name + say('»: solo se stampato sulla release, e solo per un\'issue secondaria (pulsante sotto)', '»: only if printed on the release, and only for a secondary issue (button below)'));
    }
    // 3.5 Paesi (vuoto = mondiale; per il digitale Rym non vuole il paese)
    if (D.country && !digital) {
      const C = mapCountries(D.country);
      if (setVal($('#countries'), C.value)) {
        log.push('Paese: ' + C.value);
        sum.push(C.value);
        warn.push('Paese: se Rym non riconosce "' + C.value + '", cancellalo e sceglilo dal suggerimento (3.5).');
      }
      // "Europe" solo se non c'è modo di trovare il paese: la società dei diritti spesso lo indica (wiki "Places issued")
      if (/\bEurope\b/.test(C.value)) {
        const guess = countryFromSocieties(D.rightsSocieties || []);
        if (guess.length === 1) {
          act(say('Paese: ', 'Country: ') + guess[0].country + ' (' + guess[0].society + ')', () => setVal($('#countries'), guess[0].country), '#2a6fdb');
          todo.push(say('"Europe" solo se nessun indizio dà il paese: la società dei diritti ', '"Europe" only if no clue gives the country: the rights society ') + guess[0].society + say(' indica ', ' points to ') + guess[0].country);
        } else warn.push(say('"Europe" è ammesso solo per etichette multinazionali, senza distributore nazionale e con BIEM/BEL o nessuna società dei diritti. Controlla la release.',
          '"Europe" is allowed only for multinational labels, with no national distributor and with BIEM/BEL or no rights society. Check the release.'));
        if (D.depositoLegal) warn.push(say('C\'è un Depósito Legal: indizio di un\'uscita spagnola (o portoghese).', 'There is a Depósito Legal: a hint of a Spanish (or Portuguese) issue.'));
      }
      if (C.skipped.length) warn.push('Discogs indica "' + C.skipped.join(', ') + '": è un\'area, non un paese. Lasciato vuoto (vuoto = mondiale).');
      if (C.unknown.length) {
        warn.push('Paese "' + C.unknown.join(', ') + '" non presente nell\'elenco Rym: non inserito.');
        todo.push('Paese "' + C.unknown.join(', ') + '" non esiste su Rym: sceglilo a mano (3.5)');
      }
    }

    // 3.6 Attributi dell'issue (descrizioni Discogs + testo libero del formato)
    const attrs = new Map(); // id -> nome, senza doppioni
    const add = (id, name) => { if (!attrs.has(id) && check('attrib' + id)) attrs.set(id, name); };
    const texts = D.formatTexts || [];
    const freeText = texts.join(' | ');
    const vinyl = fmt === 95 || fmt === 96;
    desc.forEach((x) => { if (ATTRIB[x]) add(ATTRIB[x], x); });
    SPEEDS.forEach(([re, id, name]) => { if (mdesc.concat(texts).some((x) => re.test(x.trim()))) add(id, name); });
    if (vinyl) {
      const w = (desc.join(' | ') + ' | ' + freeText).match(WEIGHT_RE);
      if (w) add(WEIGHTS[w[1]], w[1] + ' gram');
      if (isColored(D.vinylTexts && D.vinylTexts.length ? D.vinylTexts : texts)) add(32, 'Colored Vinyl');
    }
    TEXT_ATTRIBS.forEach(([re, id, name, formats, inTitle]) => {
      if (formats && !formats.includes(fmt)) return;
      if (re.test(freeText) || (inTitle && re.test(D.title || ''))) add(id, name);
    });
    // Bonus tracks: anche da un'intestazione "Bonus" nella tracklist o da "(Bonus Track)" nei titoli
    if (D.bonusHeading || (D.tracks || []).some((t) => /bonus track/i.test(t.title))) add(62, 'Bonus Tracks');
    // Digital download: solo coupon/codice nella confezione (non l'acquisto Bandcamp)
    if (SRC !== 'Bandcamp' && !digital && /download (code|card|coupon|voucher)|includes? (a )?(digital )?download/i.test(freeText + ' ' + (D.notes || ''))) add(101, 'Digital Download');
    if (D.boxSet) add(12, 'Box Set');
    if (D.formatName === 'Memory Stick') add(80, 'USB/Flash Drive');
    if (digital && D.noArt) add(83, 'No Artwork [Digital]');
    // secondo supporto DVD insieme al CD: probabile "Bonus DVD"
    const media = (D.formatsAll || []).filter((x) => !['Box Set', 'All Media'].includes(x.name));
    if (media.length > 1 && fmt === 60 && media.slice(1).some((x) => /^(DVD|Blu-ray)/.test(x.name))) { add(51, 'Bonus DVD'); warn.push(say('Bonus DVD: verifica che il DVD abbia materiale in più rispetto all\'uscita originale.', 'Bonus DVD: check that the DVD has material beyond the original release.')); }
    if (media.length > 1 && vinyl && media.slice(1).some((x) => x.name === 'CD')) warn.push(say('Vinile con CD: "Bonus CD" solo se il CD ha materiale in più, non se è lo stesso album.', 'Vinyl with a CD: "Bonus CD" only if the CD has extra material, not if it is the same album.'));
    // confezione citata solo nelle note Discogs (Discogs la mette lì se non distingue la release): da confermare
    PACK_NOTES.forEach(([re, id, name, fmts]) => {
      if (attrs.has(id) || (fmts && !fmts.includes(fmt)) || !re.test(D.notes || '')) return;
      act(say('Spunta ', 'Tick ') + name + say(' (dalle note)', ' (from the notes)'), () => { if (check('attrib' + id)) attrs.set(id, name); }, '#555');
    });
    if (D.formatName === 'Flexi-disc') add(66, 'Flexi-disc');
    if (desc.includes('Unofficial Release') && (desc.includes('Mixed') || desc.includes('Mixtape'))) add(100, 'Unauthorized mixtape/DJ mix');
    // regole Rym di esclusione
    const drop = (id) => { if (attrs.has(id)) { const el = document.getElementById('attrib' + id); if (el && el.checked && touched.attribs.has('attrib' + id)) { el.click(); touched.attribs.delete('attrib' + id); } attrs.delete(id); } };
    if (attrs.has(73)) drop(16);                // Numbered: niente Limited
    if (attrs.has(60)) drop(81);                // replica LP: niente Paper/Cardboard Sleeve
    if (attrs.has(110)) drop(81);               // MusicPac: niente Paper/Cardboard Sleeve
    if (['i', 'e', 'c'].includes(G.type)) drop(37); // Abridged: non per singoli, EP e compilation
    if (attrs.size) log.push('Attributi: ' + [...attrs.values()].join(', '));

    // 4.3 Attributi di performance
    const perf = [];
    P.attrs.forEach(([id, name, why]) => { if (!attrs.has(id) && check('attrib' + id)) { attrs.set(id, name); perf.push(name + ' (' + why + ')'); } });
    if (perf.length) log.push('Performance: ' + perf.join(', '));
    warn.push(...P.warn);
    if (P.liveHint) {
      todo.push(say('Live? Lo dicono ', 'Live? The ') + P.liveHint + say(', ma non più del 50% delle tracce: spuntalo solo se registrato davanti a un pubblico vero', ' say so, but not more than 50% of the tracks: tick it only if recorded in front of a real audience'));
      act(say('Spunta Live', 'Tick Live'), () => { if (check('attrib5')) attrs.set(5, 'Live'); }, '#555');
    }
    // remix non autorizzati: file under ai remixer, l'artista originale solo nei crediti in testo semplice (wiki "Digital releases" §5)
    if (desc.includes('Unofficial Release') && P.attrs.some((a) => a[0] === 24)) todo.push(say('Remix non autorizzati: file under ai remixer; l\'artista originale solo nei crediti (testo semplice, ruolo performer)', 'Unauthorized remixes: file under the remixers; the original artist only in the credits (plain text, performer role)'));
    // colonne sonore: file under ai compositori con almeno il 25%, altrimenti Various Artists (wiki §3.2)
    if (!D.classical && P.attrs.some((a) => [53, 54, 55, 56].includes(a[0]))) {
      const comps = [...new Set((D.creditList || []).filter((c) => /composed by|^composer|^score|music by/i.test(c.role)).map((c) => c.name))];
      if (comps.length) {
        todo.push(say('Colonna sonora: file under ai compositori con almeno il 25% della release: ', 'Soundtrack: file under the composers with at least 25% of the release: ') + comps.slice(0, 4).join(', '));
        comps.slice(0, 5).forEach((c) => act(say('Cerca compositore: ', 'Search composer: ') + c, () => searchPerformer(c), '#2a6fdb'));
      }
    }
    // data di registrazione (solo primary issue): dalle note "Recorded…" o dalla data nel titolo di un live
    const rec = recordingDates();
    if (rec) {
      if (primary) {
        const setRec = (pre, d) => { setSelect(pre + '_year', d.y); if (d.m) setSelect(pre + '_month', d.m); if (d.d) setSelect(pre + '_day', d.d); };
        setRec('rec_from', rec.from); if (rec.to) setRec('rec_to', rec.to);
        touched.fields.add('rec');
        log.push(say('Data di registrazione: ', 'Recording date: ') + fmtDate(rec.from) + (rec.to ? ' → ' + fmtDate(rec.to) : '') + ' (' + rec.why + ')');
        sum.push('rec. ' + fmtDate(rec.from));
      } else log.push(say('Data di registrazione ', 'Recording date ') + fmtDate(rec.from) + say(': solo sulla primary issue', ': primary issue only'));
    }
    // lingue dei testi (solo primary issue): stima dai titoli, da confermare
    const langs = lyricLanguages(T);
    if (langs.length && primary) {
      act(say('Lingue: ', 'Languages: ') + langs.join(', '), () => { setVal($('#languages'), langs.join(', ')); touched.fields.add('languages'); }, '#2a6fdb');
      todo.push(say('Lingue stimate dai titoli: ', 'Languages estimated from the titles: ') + langs.join(', ') + say(' (solo se i testi sono davvero in queste lingue)', ' (only if the lyrics really are in them)'));
    }
    const flagWarn = T.warn.find((w) => w.startsWith('Maiuscole: controlla'));
    if (flagWarn) todo.push('Maiuscole da verificare: ' + flagWarn.replace(/^Maiuscole: controlla (.*?): minuscolo.*$/, '$1'));

    // 3.7 Tracklist (via modalità Advanced, poi ritorno a Simple come richiede Rym)
    if (T.tracks.length) {
      try {
        W.goAdvanced();
        $('#track_advanced').value = T.tracks.map((t) => t.pos + '|' + t.title + '|' + t.dur).join('\n');
        W.goSimple();
        touched.tracks = true;
        const heads = T.tracks.filter((t) => t.header).length;
        log.push('Tracce: ' + (T.tracks.length - heads) + (heads ? ' + ' + heads + ' intestazioni (opere in più movimenti, senza numero)' : ''));
        sum.push((T.tracks.length - heads) + ' tracce' + (heads ? ' + ' + heads + ' intestazioni' : '') + (isVinyl() && !durVinyl && (D.tracks || []).some((t) => t.dur) ? ', senza minutaggio' : ''));
      } catch (e) {
        warn.push('Tracklist non inserita: usa il tasto "Copia tracce" e incollale in modalità Advanced.');
        todo.push('Tracklist non inserita: usa "Copia tracce" e incollala in Advanced');
      }
    }

    // 5.1 Fonti: link + cosa viene da dove (i mod lo chiedono, wiki "Sources")
    const notes = $('#notes');
    if (notes) {
      const block = sourcesText();
      if (!notes.value.includes(block)) {
        setVal(notes, (notes.value ? notes.value.replace(/\s+$/, '') + '\n' : '') + block);
        touched.notesUrl = block;
      }
    }
    log.push(say('Fonte: ', 'Source: ') + SRC);
    if (D.fromMaster) todo.push(say('Dal master Discogs è stata presa la release principale: controlla che sia l\'issue che hai', 'The main release was taken from the Discogs master: check it is the issue you own'));
    if (SRC === 'Discogs') warn.push(say('Discogs è una fonte secondaria per Rym: verifica sulla tua copia.', 'Discogs is a secondary source for Rym: check against your copy.'));

    // Avvisi generali
    if (desc.includes('Reissue') || desc.includes('Repress')) { warn.push('È una ristampa: imposta la "Primary issue" (1.1).'); todo.push('Ristampa: imposta la primary issue (1.1)'); }
    else if (D.masterYear && D.year && +D.year > +D.masterYear && D.mainRelease !== D.id) {
      warn.push('Discogs: la prima uscita di questo disco è del ' + D.masterYear + ', questa è del ' + D.year + '. Probabile ristampa: va aggiunta come issue della release esistente (1.1).');
      todo.push('Probabile ristampa (prima uscita ' + D.masterYear + '): aggiungila come issue (1.1)');
    }
    if ((D.featured || []).length) {
      warn.push('Featured su Discogs: ' + D.featured.join(', ') + '.');
      todo.push('Featured da aggiungere nei crediti: ' + D.featured.slice(0, 4).join(', ') + (D.featured.length > 4 ? ' e altri' : ''));
    }
    // crediti: righe pronte (testo semplice) da collegare con la ricerca, featured/guest/remixer compresi
    const lines = creditLines(T);
    if (lines.length) {
      act(say('Aggiungi ', 'Add ') + lines.length + (lines.length === 1 ? say(' riga di crediti', ' credit line') : say(' righe di crediti', ' credit lines')), () => addCreditLines(lines), '#27ae60');
      todo.push(say('Crediti pronti (pulsante sotto): poi collega gli artisti con 🔍', 'Credits ready (button below): then link the artists with 🔍'));
      if (unknownRoles.size) todo.push(say('Ruoli non trovati nella lista Rym, correggili: ', 'Roles not found in the Rym list, fix them: ') + [...unknownRoles].join(', '));
      if (!primary) warn.push(say('Issue secondaria: aggiungi solo i crediti che non sono già sulla primary (es. bonus track, featured, remixer).', 'Secondary issue: add only the credits not already on the primary (e.g. bonus tracks, featured, remixers).'));
    }
    if (desc.includes('Promo')) { warn.push('Promo: per Rym è un\'issue secondaria della release principale (1.1).'); todo.push('Promo: va come issue secondaria (1.1)'); }
    if ((D.labels || []).length > 1) { warn.push('Più etichette su Discogs: Rym ne accetta una, la più specifica (o la più vicina all\'artista).'); todo.push('Più etichette su Discogs: scegline una'); }

    filledRaw = rawSeen;
    settingsChanged = false;
    renderPanel();
    suggestions.forEach((x) => actions.unshift({ title: x }));
    report({ sum, spunte: [...attrs.values()], todo, details: log.concat(warn) }, actions);
  }

  // ---- pannello ----
  const panel = css(document.createElement('div'), {
    position: 'fixed', top: '70px', right: '15px', width: '320px', maxHeight: '80vh', overflowY: 'auto',
    background: '#1e2433', color: '#eee', border: '2px solid #c0392b', borderRadius: '8px', padding: '10px',
    zIndex: 99999, fontSize: '13px', lineHeight: '1.4', boxShadow: '0 3px 10px rgba(0,0,0,.5)'
  });
  const banner = (text, color) => '<div style="background:' + color + ';color:#fff;border-radius:4px;padding:6px;margin:6px 0">' + esc(text) + '</div>';

  // (Ri)disegna il pannello con la release corrente; lo riapre se era stato chiuso
  function renderPanel() {
    if (!D) return;
    const lab0 = (D.labels || [])[0] || {};
    const when = D.savedAt ? new Date(D.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const other = artistMismatch();
    panel.innerHTML =
      '<div style="font-weight:bold;font-size:15px;margin-bottom:4px">Postino · ' + esc(SRC) + ' → Rym<a id="drym_x" href="javascript:void(0)" title="' + esc(say('Chiudi', 'Close')) + '" style="float:right;color:inherit;text-decoration:none;opacity:.6">✕</a></div>' +
      '<div><b>' + esc(D.artist) + '</b> – ' + esc(D.title) + '</div>' +
      '<div>' + esc([D.year, D.formatName === 'File' ? 'Digitale' : D.formatName, (D.descriptions || []).join(', ')].filter(Boolean).join(' · ')) + '</div>' +
      '<div>' + esc([lab0.name, lab0.catno, D.country].filter(Boolean).join(' · ')) + '</div>' +
      '<div style="opacity:.7">' + (D.tracks || []).filter((t) => !t.header).length + ' tracce' + (when ? ' · inviata alle ' + when : '') + '</div>' +
      // le spunte preparano i dati senza toccare il modulo: si applicano con "Compila modulo"
      (filledRaw && settingsChanged && filledRaw === rawSeen ? banner(say('Impostazioni cambiate: premi "Compila modulo" per applicarle (le tue correzioni a mano verranno sostituite).', 'Settings changed: press "Fill form" to apply them (your manual corrections will be replaced).'), '#2a6fdb') : '') +
      (filledRaw && filledRaw !== rawSeen ? banner('Nuova release caricata. Premi "Compila modulo": i dati della precedente verranno sostituiti.', '#2a6fdb') : '') +
      (other ? banner('Questa pagina è dell\'artista "' + other + '", la release è di "' + D.artist + '". Apri la pagina Add release giusta.', '#b03a2e') : '') +
      '<div id="drym_bar"></div><div id="drym_out" style="margin-top:6px"></div>';

    const bar = panel.querySelector('#drym_bar');
    panel.querySelector('#drym_x').addEventListener('click', () => panel.remove());
    bar.appendChild(btn('Compila modulo', fill, '#27ae60'));
    if (other) bar.appendChild(btn('Cerca "' + D.artistSearch + '" su Rym', () => GM_openInTab('https://rateyourmusic.com/search?searchterm=' + encodeURIComponent(D.artistSearch) + '&searchtype=a', { active: true }), '#b03a2e'));
    bar.appendChild(btn('Copia tracce', () => GM_setClipboard(prepare().tracks.map((t) => t.pos + '|' + t.title + '|' + t.dur).join('\n'))));
    if (D.country) bar.appendChild(btn('Copia paese', () => GM_setClipboard(D.country)));
    if ((D.credits || []).length) bar.appendChild(btn('Copia crediti', () => GM_setClipboard(D.credits.join('\n'))));
    // controllo doppioni: la wiki chiede di cercare sempre prima di inserire
    bar.appendChild(btn(say('Cerca su Rym', 'Search Rym'), () => GM_openInTab('https://rateyourmusic.com/search?searchterm=' + encodeURIComponent((D.artistSearch || D.artist) + ' ' + D.title) + '&searchtype=l', { active: true }), '#2a6fdb'));
    if (D.artUrl) bar.appendChild(btn(say('Copertina originale', 'Original cover'), () => GM_openInTab(D.artUrl, { active: true }), '#2a6fdb'));
    if (D.embed) bar.appendChild(btn(say('Copia embed (media link)', 'Copy embed (media link)'), () => { GM_setClipboard(D.embed); toast(say('Embed copiato: incollalo in "Submit media links" sulla pagina della release.', 'Embed copied: paste it in "Submit media links" on the release page.')); }, '#2a6fdb'));
    if (D.physicalApplied) bar.appendChild(btn(say('Torna al digitale', 'Back to digital'), () => { rawSeen = null; D = null; loadData(); renderPanel(); }, '#555'));
    bar.appendChild(btn('Cancella dati', () => { GM_deleteValue(KEY); D = null; panel.remove(); }, '#7f1d1d'));

    // spiegazioni delle spunte nel tooltip, per tenere il pannello corto
    const lbl = css(document.createElement('label'), { display: 'block', margin: '3px', cursor: 'pointer' });
    const C = capsState();
    lbl.title = say('Senza spunta: solo iniziale maiuscola (titoli non inglesi)', 'Unticked: first letter only (non-English titles)') + (C.auto ? say('. Ora in automatico, titolo per titolo, secondo la lingua.', '. Now automatic, title by title, by language.') : '');
    lbl.innerHTML = '<input type="checkbox" id="drym_caps"' + (C.english ? ' checked' : '') + '> ' + esc(say('Capitalizzazione inglese', 'English capitalization')) +
      (C.auto ? ' <span style="opacity:.6;font-size:11px">(auto)</span>' : '');
    lbl.querySelector('input').addEventListener('change', (e) => { capsMode = e.target.checked; settingsChanged = true; renderPanel(); });
    bar.appendChild(lbl);
    if (keepCaps) lbl.querySelector('input').disabled = true;

    const kc = css(document.createElement('label'), { display: 'block', margin: '3px', cursor: 'pointer' });
    kc.title = say('Solo per grafie ufficiali ammesse dalla wiki (es. nomi o titoli stilizzati)', 'Only for official stylings allowed by the wiki (e.g. stylized names or titles)');
    kc.innerHTML = '<input type="checkbox" id="drym_keepcaps"' + (keepCaps ? ' checked' : '') + '> ' + esc(say('Maiuscole come sulla fonte', 'Keep source capitalization'));
    kc.querySelector('input').addEventListener('change', (e) => { keepCaps = e.target.checked; settingsChanged = true; renderPanel(); });
    bar.appendChild(kc);

    // edizioni fisiche in vendita su Bandcamp
    if (SRC === 'Bandcamp' && (D.physical || []).length && !D.physicalApplied) {
      const box = css(document.createElement('div'), { margin: '6px 3px 2px', fontSize: '12px', opacity: '.9' });
      box.textContent = say('Edizioni fisiche su Bandcamp:', 'Physical editions on Bandcamp:');
      bar.appendChild(box);
      D.physical.forEach((p) => bar.appendChild(btn((p.format || p.type || '?') + (p.name ? ' – ' + p.name.slice(0, 40) : ''), () => applyPhysical(p), '#8e44ad')));
    }

    if (isVinyl() && !durNotPrinted() && (D.tracks || []).some((t) => t.dur)) { // solo se Discogs ha il minutaggio
      const dl = css(document.createElement('label'), { display: 'block', margin: '3px', cursor: 'pointer' });
      dl.title = say('Vinile: su Rym solo se è stampato sul disco o sulla copertina', 'Vinyl: on Rym only if printed on the record or the sleeve');
      dl.innerHTML = '<input type="checkbox" id="drym_dur"' + (durVinyl ? ' checked' : '') + '> ' + esc(say('Importa minutaggio (se stampato)', 'Import track times (if printed)'));
      dl.querySelector('input').addEventListener('change', (e) => { durVinyl = e.target.checked; settingsChanged = true; renderPanel(); });
      bar.appendChild(dl);
    }

    // ridisegnando il pannello (es. dopo una spunta) il riepilogo resta
    if (lastReport && filledRaw === rawSeen) report(...lastReport);
    if (!panel.isConnected) document.body.appendChild(panel);
  }

  // ---- aggiornamento senza ricaricare la pagina ----
  // Quando invii un'altra release da Discogs/Bandcamp, il pannello si aggiorna da solo.
  function onNewData(raw) {
    if (loadData(raw)) renderPanel();
  }
  if (typeof GM_addValueChangeListener === 'function') {
    try { GM_addValueChangeListener(KEY, (name, oldValue, newValue) => { if (newValue) onNewData(newValue); }); } catch (e) { /* ignora */ }
  }
  // riserva: ricontrolla quando torni sulla scheda o il browser la riprende dalla cache
  window.addEventListener('focus', () => onNewData());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onNewData(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) onNewData(); });
  onNewData();

  // Riepilogo: riga verde (cosa è stato compilato), "Da fare" (solo ciò che richiede un intervento),
  // e tutto il resto in "Dettagli", chiusa di base.
  function report(R, actions) { // actions = titoli proposti ({ title }) e pulsanti "applica" ({ label, run })
    lastReport = [R, actions];
    const out = panel.querySelector('#drym_out');
    out.innerHTML =
      '<div style="color:#7dda8a;font-size:12px">✔ ' + esc(R.sum.join(' · ')) + (R.spunte.length ? ' · ' + esc(say('spunte: ', 'ticked: ') + R.spunte.join(', ')) : '') + '</div>' +
      (R.todo.length ? '<div style="color:#f5c26b;margin-top:6px;font-size:13px"><b>' + say('Da fare', 'To do') + '</b><br>• ' + R.todo.map(esc).join('<br>• ') + '</div>' : '') +
      '<details style="margin-top:6px;opacity:.8;font-size:12px"><summary style="cursor:pointer">Dettagli</summary>' +
      R.details.map((d) => '<div>' + esc(d) + '</div>').join('') + '</details>';
    const suggested = (actions || []).filter((a) => a.title != null).map((a) => a.title);
    (actions || []).filter((a) => a.title == null).forEach((a) => {
      out.appendChild(btn(a.label, (e) => {
        try { a.run(); e.target.textContent = '✔ ' + a.label; } catch (err) { toast(String(err && err.message || err), false); }
      }, a.color || '#2a6fdb'));
    });
    [...new Set(suggested)].forEach((t) => {
      out.appendChild(btn('Usa titolo: ' + t, (e) => {
        setVal($('#title'), t);
        out.querySelectorAll('button').forEach((b) => { if (b.textContent.startsWith('Titolo applicato')) b.textContent = b.dataset.label; b.disabled = false; });
        e.target.dataset.label = e.target.textContent;
        e.target.textContent = 'Titolo applicato ✔';
        e.target.disabled = true;
      }, '#8e44ad'));
    });
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
