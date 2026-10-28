# Postino for Rateyourmusic

**Postino** is a userscript that takes a release from **Discogs** or **Bandcamp** and fills in the **Rateyourmusic "Add Release" form** for you, following the Rym wiki.

It never submits anything by itself: you check the form, press Preview and submit. You always have the last word.

---

## What it fills in

- **Release type**: album, EP, single, compilation, DJ mix, mixtape, additional release, video, music video… When Discogs gives no clear info, the panel says the type is an estimate.
- **Category**: single artist, split (2-4 artists) or Various Artists (5 or more). It starts the search for the first artist and adds a search button for each of the others.
- **Date, title, format and disc size** (also non-standard sizes). It warns about dates that are impossible for the format (a CD before 1982, a digital release before 2000) and about dates that look like the © year.
- **Localized English title** for titles in a non-Latin script, when Discogs gives a translation (`Original = Translation`).
- **Label**: the most specific one, skipping label groups and distributors, as Rym asks.
- **Catalog number** (`n/a` when there is no label or no number, as Rym asks). Amazon codes, label codes (LC), SPARS codes and barcodes are dropped.
- **Country**, with the official Rym names (Russia → Russian Federation, Czech Republic → Czechia…). No country for digital releases.
- **Issue attributes**: colored vinyl, 180 gram, 33 rpm, gatefold, digipak, limited, numbered, remastered, box set, bonus DVD, USB, no artwork…
- **Performance attributes**: live, remixes, instrumental, demo recordings, promotional demo, archival, soundtrack, songs "inspired by", Creative Commons, AI-generated (only when stated)… (Rym thresholds: more than 50% of the tracks; when only the title or the notes say "live", the panel asks you to check)
- **Recording date**, from the "Recorded…" notes or from the date in the title of a live release (primary issue only).
- **Tracklist**:
  - Rym positions (`CD.1` → `1`, `1-1` → `1.1`, `AA` → `B`, `A01` → `A1`); parallel grooves are left as they are
  - lines without a number for suites, works and sections, in bold (`[b]…[/b]`)
  - a `CD` / `DVD` line before each medium
  - `Digital Bonus Tracks` header with its own numbering
  - untitled tracks as `[untitled]`; rows without audio removed
  - "(Original Mix)" and "feat. …" removed from titles (featured artists go in the credits)
  - on splits and Various Artists releases: `Artist - Title`
- **Text**: straight apostrophes and quotes, plain hyphens, round brackets, no invisible or "decorative" characters.
- **Capitalization**: Rym rules for English titles, first letter only for other languages, with the special rules for Turkish, Indonesian, Filipino, French, Dutch and Russian. German and non-Latin scripts are left as they are. The language is detected title by title, and you can switch it with a checkbox.
- **Sources**: the link and the list of data taken from it, in English for the moderators.

## What it suggests

Uncertain choices are never applied by themselves: they appear as buttons under the **To do** list, and you click only the ones you agree with.

- **Credit lines** with Rym roles and tracks (`A1 to B3` → `A1-A6, B1-B3`), featured and guest included. Press 🔍 on a line to search the artist: when you click the result, the line becomes linked.
- **Credited name** with "featuring" / "with" or a name variation.
- **Edition name** (for example `30th Anniversary Edition`), only for secondary issues.
- **Languages** of the lyrics, estimated from the titles.
- **Colour variant** in the title (`[red marbled vinyl]`), only if several colours of the same issue exist.
- **Country** from the rights society when Discogs says "Europe" (SIAE → Italy, GEMA → Germany…).
- **Packaging** mentioned only in the Discogs notes (gatefold, digipak…).
- **Composers** for classical releases and soundtracks; performers in the Rym order for classical (orchestra, choir, conductor, soloists).
- **Single title** in the Rym standard (`Track A / Track B`) and the title for untitled releases.
- **Various Artists**: the label classifier (`[LabelXXXX]`) fills in by itself as soon as you pick the label.

## Bandcamp extras

- Release date or publish date, with an explanation when they differ.
- A warning for pre-orders and for tracks that belong to an album.
- **Original cover** (the file uploaded by the artist, not the square preview).
- **Embed code** for the Rym media links.
- **Physical editions** on sale (vinyl, CD, cassette): one click turns the release into a physical issue.

## Install

1. Install **Tampermonkey** (free) on Chrome or Firefox, Mac or Windows.
2. **Chrome only**: go to *Extensions → Tampermonkey → Details* and turn on **"Allow user scripts"**.
3. Install the script:
   - open [`postino.en.user.js`](postino.en.user.js), click **Raw**, and Tampermonkey will offer to install it, **or**
   - click the Tampermonkey icon → *Create a new script*, paste the file and save.

An Italian version is also available: [`postino.it.user.js`](postino.it.user.js).

## How to use

1. Open a release (or a master) on **Discogs**, or an album on **Bandcamp**.
2. Press the red **→ Rym** button (bottom right). A notice confirms that the data is saved.
3. Open the **Add Release** page of the artist on Rym. If it is already open, the panel updates by itself.
4. Press **Search Rym** in the panel to check that the release is not already on the site.
5. Press **Fill form**.
6. Read the **To do** list, use the buttons you need, check everything, then press **Preview** and submit.

Checkboxes in the panel (they only prepare the data: press **Fill form** to apply them):

- **English capitalization**: untick it for non-English titles (first letter only).
- **Keep source capitalization**: leaves names and titles as on Discogs or Bandcamp, for the official stylings the Rym wiki allows (explain why in the sources).
- **Import track times** (vinyl only): Rym wants track times on vinyl only if they are printed on the record. Hidden when the Discogs notes say they are not printed.
- **I own a copy**: adds "I own this release" to the sources. It stays saved.

## Known limits

- **Rym has no API**: you still pick every artist and the label from the search results. For splits you add each artist yourself (one search button per artist).
- **Credit roles** are translated from Discogs for the most common ones: check them at preview.
- **Proper names** in non-English titles cannot be detected: check them by hand.
- **Estimates**: the release type, the languages and some attributes are estimated when the source gives no clear info. The panel always tells you when.
- **Discogs is a secondary source** for Rym: always check the data against your copy.
- **Bandcamp**: only `*.bandcamp.com` pages are supported, not artists with their own domain.

## Privacy

The script only reads the release from the Discogs API or from the Bandcamp page. The data and your settings are saved in Tampermonkey on your computer, and only used to fill in the Rym form. Nothing is sent anywhere else.

## Feedback

Bug reports and ideas are welcome. Please open an issue with the link to the Discogs or Bandcamp release.
