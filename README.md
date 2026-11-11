# Postino 1.2.0 for Rateyourmusic

**Postino** is a userscript that takes a release from **Discogs**, **Bandcamp**, **Beatport**, **MusicBrainz**, **Apple Music** or **Deezer** and fills in the **Rateyourmusic "Add Release" form** for you, following the Rym wiki.

It never submits anything by itself: you check the form, press Preview and submit. You always have the last word.

---

## What's new in 1.2.0

- **New sources**: MusicBrainz, Apple Music and Deezer.
- **Import from link**: paste the link of a release in the Rym panel, without opening the source.
- **Classical music** following the Rym wiki: performers and composers in "File under", work headers, links to the works, credits and title.
- **Media links**: on the Rym media link page, a small panel inserts the listening links of the release.
- **Covers in high quality** from every source.
- **Capitalization**: separate choice for the release title and the tracklist; German nouns; artist names with English rules; Roman numerals, file extensions, phrasal verbs.
- Many fixes: splits and collaborations, remixes, vinyl sides, lettered positions, catalog numbers, credit roles.

## What it fills in

- **Release type**: album, EP, single, compilation, DJ mix, mixtape, additional release, video, music video... An "EP" stated in the title or by the source wins; club 12"s with 4-6 long tracks stay EPs up to 45 minutes. A split or Various Artists release with one track per artist is an EP, not a single. On Various Artists releases, "Compilation" is used only for previously released material. "Mixed" means DJ mix only when the tracks are by different artists. When the source gives no clear info, the type is an estimate (see **Details**).
- **Category**: single artist, split, collaboration or Various Artists (5 or more artists):
  - **split**: every track is by only one of the artists
  - **collaboration**: all tracks are by the artists together, or the tracklist has no names. The script searches the profile of the collaboration (`A & B`) first; if you pick it, the single artists you add after it are set as uncredited
  - **not applicable**: mixed cases (some tracks alone, some together)
  - Rym sometimes resets this choice when "File under" changes: the script sets it again (unless you changed it by hand)
  - a release filed under its compiler or presenter, with tracks by other artists, is a Various Artists release: the compiler goes in the credits and "Selector Comp" is ticked
  - mixtape hosts go only in the credits, never in "File under"
- **Classical music** (wiki "Classical music"):
  - "File under" performers: only the ones on the cover, in the order orchestra, choir or ensemble, conductor, soloists. Performers on at least 25% of the release but not on the cover get a "Search (uncredited)" button, and "Credited name" is unticked by itself. Members of a quartet or ensemble are left out
  - "File under" composers: only the ones who wrote at least 25% of the release (by duration)
  - collaboration type "Neither / not applicable"; composition credits (composer, lyricist, arranger) are not added to the release credits, the other roles of the same person stay
  - title without the names of composers and performers; works by the same composer separated by `;`
  - credited name when the performers are written with "and" / "&" (`Felix` + `Weingartner and The London Symphony Orchestra`)
  - tracklist: works in several movements as headers, a work in one track as `Work: Movements`; a 🔍 on each line opens the Rym work search and replaces the line with `[WorkNNN,title as printed]`
- **Date, title, format and disc size** (also non-standard sizes). It warns about dates that are impossible for the format and about dates that look like the © year.
- **Localized English title** for titles in a non-Latin script, when the source gives a translation.
- **Label**: the most specific one, skipping label groups and distributors. Beatport's "Label" tag (`Howl Label`) is removed.
- **Catalog number**: left empty when there is none. A code in the release title (`[UX009] Title`) or repeated in all track titles is moved to the catalog number. Amazon codes, label codes (LC), SPARS codes and barcodes are dropped.
- **Country**, with the official Rym names. No country for digital releases. From the rights society when Discogs says "Europe" (SIAE → Italy, GEMA → Germany...).
- **Issue attributes**: colored vinyl, 180 gram, 33 rpm, gatefold, digipak, limited, numbered, remastered, box set, bonus DVD, USB, no artwork...
- **Digital releases**: Digital file and Streaming; stores like Beatport get Digital file only (they are not listening services).
- **Performance attributes**: live, remixes, instrumental, demo recordings, archival, soundtrack, Creative Commons... (more than 50% of the tracks). Remixes are recognised from `(Name Remix)` titles, from words like `Bizzaremix`, from the Remix credits and from release titles like `(Remix)` or `(The Mixes)`; the artist's own versions are not remixes.
- **Recording date**, only when the source states it.
- **Tracklist**:
  - Rym positions (`CD.1` → `1`, `1-1` → `1.1`, `AA` → `B`, `A01` → `A1`); parallel grooves are left as they are
  - lettered positions as normal tracks (`A1a, A1b, A2` → `A1, A2, A3`)
  - vinyl with numbers only (`1, 2, 3, 4`) → sides (`A1, A2, B1, B2`), with a note to check
  - lines without a number for suites, works and sections, in bold; a `CD` / `DVD` line before each medium
  - untitled tracks as `[untitled]`; rows without audio removed
  - "(Original Mix)", "feat. ..." and the release title repeated in every track are removed
  - `Artist - Title` when the tracks have their own artists, with several artists written `A & B` or `A, B & C`
  - splits: as soon as you pick an artist in "File under", its name in the tracklist becomes the Rym code; Various Artists: a 🔍 next to each artist searches it and links it in all its tracks. When the Rym name is different from the printed one, the code keeps the printed name (`[Artist1409211,The Willers Brothers]`)
- **Text**: straight apostrophes and quotes, plain hyphens, round brackets, `Vol. 1`, `RMX` → `Remix`, no invisible or "decorative" characters.
- **Capitalization**:
  - English rules for English titles (slang like `da` for "the" included), Roman numerals in capitals, `A WAV File`, phrasal verbs (`Keep On`, `Come In`)
  - first letter only for other languages, with the special rules for Turkish, Indonesian, Filipino, French, Dutch and Russian; version words in brackets stay in English capitals (`(Extended Mix)`)
  - German: nouns capitalized when they can be recognised (after articles, possessives, `-ung`, `-heit`...)
  - artist names follow the English rules (`House of Blue`), except deliberate stylings (all lowercase, all capitals, camelCase)
  - titles in two scripts: the translation goes in brackets (`Күһүннүү уураһыы (Autumn Kiss)`)
  - the language of the record is used only when it is reliable
- **Sources**: the link of the release.

## What it suggests

Uncertain choices are never applied by themselves: they appear as buttons, and you click only the ones you agree with. Short notes stay in **Details**, closed by default.

- **Credit lines** with the official Rym roles and tracks, featured and guest included. Remixers are taken from `(Name Remix)` titles when the source has no credits; Bandcamp credits written in the text (`mastered by ...`) are read too. Roles that Rym does not have are left out and listed in **Details**. Press 🔍 on a line to search the artist.
- **Credited name** with "featuring" / "with" or a name variation; name prefixes by country (`van`, `von`, `de`...).
- **Edition name**, only for secondary issues.
- **Languages** of the lyrics, estimated from the titles.
- **Packaging** mentioned only in the Discogs notes.
- **Single title** in the Rym standard (`Track A / Track B`).
- **Various Artists**: the label classifier fills in by itself as soon as you pick the label.

## Source extras

- **Discogs**: masters too (the main release is used); aliases and real name of the artist, so no false "another artist's page" warning.
- **Bandcamp**: release or publish date, pre-orders, physical editions on sale (one click turns the release into a physical issue), label pages with `Artist - Title` in the page title.
- **Beatport**: versions in the titles, remixers in the credits, `DAV (Croatia)` tags cleaned up.
- **MusicBrainz**: works and composers, movements grouped under their work, formats and positions.
- **Apple Music** and **Deezer**: tracks, date, label, writers and other credits.
- **Original cover** in high quality from every source.

## Media links

After you add the release, open its **media link** page on Rym: a small Postino panel shows the listening links of the release (Bandcamp embed, Apple Music, Deezer, Spotify and the others Rym accepts) and inserts the one you click.

## Install

1. Install **Tampermonkey** (free) on Chrome or Firefox, Mac or Windows.
2. **Chrome only**: go to *Extensions → Tampermonkey → Details* and turn on **"Allow user scripts"**.
3. Install the script:
   - open [`postino.en.user.js`](postino.en.user.js), click **Raw**, and Tampermonkey will offer to install it, **or**
   - click the Tampermonkey icon → *Create a new script*, paste the file and save.

An Italian version is also available: [`postino.it.user.js`](postino.it.user.js).

## How to use

1. Open a release on **Discogs**, **Beatport**, **MusicBrainz**, **Apple Music** or **Deezer**, or an album on **Bandcamp**, and press the red **→ Rym** button (bottom right).
   Or paste the link of the release in the **Import from link** field of the Rym panel.
2. Open the **Add Release** page of the artist on Rym. If it is already open, the panel updates by itself.
3. Press **Fill form**.
4. Use the buttons you need, check everything, then press **Preview** and submit.

Panel options (they only prepare the data: press **Fill form** to apply them):

- **Caps – title / tracklist**: Auto, English, Other language, As on source (for the official stylings the wiki allows).
- **Import track times** (vinyl only): Rym wants track times on vinyl only if they are printed on the record.

## Known limits

- **Rym has no API**: you still pick every artist, the label and the works from the search results.
- **Proper names** in non-English titles are recognised only in part: check them by hand.
- **Estimates**: the release type, the languages, the vinyl sides and some attributes are estimated when the source gives no clear info (see **Details**).
- **Discogs is a secondary source** for Rym: always check the data against your copy.
- **Bandcamp**: only `*.bandcamp.com` pages are supported, not artists with their own domain.
- **Beatport, Apple Music and Deezer** often host digital reissues of older records: check the dates.

## Privacy

The script only reads the release from the source (the Discogs API or the release page). The data is saved in Tampermonkey on your computer, and only used to fill in the Rym form. Nothing is sent anywhere else.

## Feedback

Bug reports and ideas are welcome. Please open an issue with the link to the release.
