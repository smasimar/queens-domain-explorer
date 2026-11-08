/** Menu search: find collectibles, Wing Altars and Crystal Monuments by name and fly to them. */

export interface SearchEntry {
  name: string;
  /** Second line, e.g. "Main Weapon · Ancient World (AUT)". */
  detail: string;
  color: string;
  /** "fasttravel" / "save" draw the landmark dot; anything else a category diamond. */
  kind: string;
  /** Extra words that match but are not shown (category, area code…). */
  keywords: string;
  /** Save state text, e.g. "collected"; null without a save. */
  state(): { text: string; done: boolean } | null;
  go(): void;
}

const MAX_RESULTS = 80;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'");

/** Lower score is better: name starts with the query, then a word starts with it, then anything. */
function score(e: SearchEntry, terms: string[], hay: string): number | null {
  if (!terms.every((t) => hay.includes(t))) return null;
  const name = norm(e.name);
  const q = terms.join(" ");
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(/[\s\-(]+/).some((w) => w.startsWith(terms[0]))) return 2;
  if (terms.every((t) => name.includes(t))) return 3;
  return 4;
}

export class Search {
  readonly input: HTMLInputElement;
  private results: HTMLElement;
  private hay: string[] = [];
  private entries: SearchEntry[] = [];
  private shown: SearchEntry[] = [];

  /** `onOpen(true)` while a query is active (the caller hides the tab bodies). */
  constructor(box: HTMLElement, results: HTMLElement, private onOpen: (open: boolean) => void) {
    this.results = results;
    box.innerHTML = `<input type="search" placeholder="Search items and places" spellcheck="false" autocomplete="off" aria-label="Search items and places"><kbd>F</kbd>`;
    this.input = box.querySelector("input")!;
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (this.input.value) {
          this.input.value = "";
          this.render();
        } else this.input.blur();
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.shown[0]?.go();
        this.input.blur();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.results.querySelector<HTMLButtonElement>("button.hit")?.focus();
      }
    });
    this.results.addEventListener("keydown", (e) => {
      const b = document.activeElement as HTMLElement | null;
      if (!b?.classList.contains("hit")) return;
      const all = [...this.results.querySelectorAll<HTMLButtonElement>("button.hit")];
      const i = all.indexOf(b as HTMLButtonElement);
      if (e.key === "ArrowDown") all[i + 1]?.focus();
      else if (e.key === "ArrowUp") (i > 0 ? all[i - 1] : this.input).focus();
      else if (e.key === "Escape") this.input.focus();
      else return;
      e.preventDefault();
    });
  }

  setEntries(entries: SearchEntry[]): void {
    this.entries = entries;
    this.hay = entries.map((e) => norm(`${e.name} ${e.detail} ${e.keywords}`));
    this.render();
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  /** Re-draw the results (e.g. after the save changed). */
  render(): void {
    const terms = norm(this.input.value).split(/\s+/).filter(Boolean);
    this.onOpen(terms.length > 0);
    this.results.innerHTML = "";
    if (!terms.length) {
      this.shown = [];
      return;
    }
    const hits: { e: SearchEntry; s: number }[] = [];
    this.entries.forEach((e, i) => {
      const s = score(e, terms, this.hay[i]);
      if (s !== null) hits.push({ e, s });
    });
    const place = (e: SearchEntry) => (e.kind === "fasttravel" ? 0 : e.kind === "save" ? 1 : 2);
    hits.sort((a, b) => a.s - b.s || place(a.e) - place(b.e) || a.e.name.localeCompare(b.e.name));
    this.shown = hits.slice(0, MAX_RESULTS).map((h) => h.e);
    const sec = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = hits.length > MAX_RESULTS
      ? `${MAX_RESULTS} of ${hits.length} results`
      : `${hits.length} result${hits.length === 1 ? "" : "s"}`;
    sec.appendChild(h);
    for (const e of this.shown) {
      const b = document.createElement("button");
      b.className = `loc hit ${e.kind}`;
      const st = e.state();
      if (st?.done) b.classList.add("done");
      b.innerHTML = `<i></i><span><b></b><small></small></span>`;
      if (e.kind !== "fasttravel" && e.kind !== "save") b.querySelector("i")!.style.setProperty("--c", e.color);
      b.querySelector("b")!.textContent = e.name;
      b.querySelector("small")!.textContent = st ? `${e.detail} · ${st.text}` : e.detail;
      b.onclick = () => {
        this.results.querySelector("button.hit.active")?.classList.remove("active");
        b.classList.add("active");
        b.blur(); // Space while flying must not press it again
        e.go();
      };
      sec.appendChild(b);
    }
    if (!this.shown.length) sec.insertAdjacentHTML("beforeend", `<p class="menu-empty">Nothing found.</p>`);
    this.results.appendChild(sec);
  }
}
