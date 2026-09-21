import * as React from 'react';
import { useMemo, useRef, useState } from 'react';

export interface SearchableDistrict {
  cdCode: string;
  dest: string;
  students: string[];
  neighborhoods: string[];
}

interface MapSearchProps {
  districts: SearchableDistrict[];
  onSelect: (dest: string) => void;
}

interface SearchResult {
  district: SearchableDistrict;
  /** What the query matched, shown under the district label. */
  detail: string;
  score: number;
}

const BOROUGHS: { digit: string; name: string; aliases: string[] }[] = [
  { digit: '1', name: 'Manhattan', aliases: ['manhattan', 'mn'] },
  { digit: '2', name: 'Bronx', aliases: ['bronx', 'the bronx', 'bx'] },
  { digit: '3', name: 'Brooklyn', aliases: ['brooklyn', 'bk'] },
  { digit: '4', name: 'Queens', aliases: ['queens', 'qn'] },
  { digit: '5', name: 'Staten Island', aliases: ['staten island', 'si'] },
];

const MAX_RESULTS = 8;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function districtLabel(cdCode: string): string {
  const borough = BOROUGHS.find((b) => b.digit === cdCode[0]);
  return `${borough?.name ?? 'District'} CD ${Number(cdCode.slice(1))}`;
}

/**
 * Reads the query as a district reference, if it looks like one: "107",
 * "cd 107", "mn07", "manhattan 7", "manhattan cd 7", or "cd 7" (any
 * borough). Returns a predicate over boro_cd codes, or null.
 */
function parseDistrictQuery(q: string): ((cdCode: string) => boolean) | null {
  let rest = q;

  // Longest alias first, so "staten island" wins over "si".
  const aliases = BOROUGHS.flatMap((b) => b.aliases.map((alias) => ({ alias, b })))
    .sort((x, y) => y.alias.length - x.alias.length);
  const hit = aliases.find(({ alias }) =>
    rest.startsWith(alias) && /^(?:$| |\d)/.test(rest.slice(alias.length)));
  const borough = hit?.b;
  if (hit) rest = rest.slice(hit.alias.length).trim();

  const prefix = rest.match(/^(?:community district|district|cd) ?/);
  if (prefix) rest = rest.slice(prefix[0].length);
  if (!/^\d{1,3}$/.test(rest)) return null;

  const district = Number(rest);
  if (borough) {
    if (rest.length > 2) return null;
    return (code) => code[0] === borough.digit && Number(code.slice(1)) === district;
  }
  // "cd 7" means district 7 in any borough; bare digits are a boro_cd prefix.
  if (prefix && rest.length <= 2) return (code) => Number(code.slice(1)) === district;
  return (code) => code.startsWith(rest);
}

/** 3 for a match at the start, 2 at a word start, 1 anywhere, 0 for none. */
function textScore(haystack: string, q: string): number {
  const h = normalize(haystack);
  if (h.startsWith(q)) return 3;
  if (h.includes(` ${q}`)) return 2;
  if (h.includes(q)) return 1;
  return 0;
}

function search(districts: SearchableDistrict[], rawQuery: string): SearchResult[] {
  const q = normalize(rawQuery);
  if (!q) return [];

  const districtMatch = parseDistrictQuery(q);
  const results: SearchResult[] = [];

  for (const district of districts) {
    if (districtMatch?.(district.cdCode)) {
      results.push({ district, detail: district.students.join(', '), score: 10 });
      continue;
    }

    // [text to match, detail to show, weight]. Names edge out neighborhoods
    // on ties, since a name search is usually for one specific story.
    const candidates: [string, string, number][] = [
      ...district.students.map((name): [string, string, number] => [name, name, 0.5]),
      ...district.neighborhoods.map((n): [string, string, number] => [n, n, 0]),
      [districtLabel(district.cdCode), district.students.join(', '), 0],
    ];
    let best: SearchResult | undefined;
    for (const [text, detail, weight] of candidates) {
      const s = textScore(text, q);
      if (s && (!best || s + weight > best.score)) best = { district, detail, score: s + weight };
    }
    if (best) results.push(best);
  }

  return results
    .sort((a, b) => b.score - a.score || a.district.cdCode.localeCompare(b.district.cdCode))
    .slice(0, MAX_RESULTS);
}

export default function MapSearch({ districts, onSelect }: MapSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `map-search-${React.useId().replace(/:/g, '')}`;

  const results = useMemo(() => search(districts, query), [districts, query]);
  const showList = open && query.trim().length > 0;

  const choose = (result: SearchResult | undefined) => {
    if (!result) return;
    onSelect(result.district.dest);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.max(0, Math.min(i + 1, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[activeIndex]);
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else inputRef.current?.blur();
      setOpen(false);
    }
  };

  return (
    <div className="map-search">
      <style>{`
        .map-search {
          position: absolute;
          top: 16px;
          left: 16px;
          /* Above the map's loading overlay (z-20): search doesn't need
             the map, so it stays usable while the map loads. */
          z-index: 25;
          width: min(320px, calc(100% - 80px));
          font-family: inherit;
        }
        .map-search input {
          width: 100%;
          box-sizing: border-box;
          padding: 9px 12px 9px 34px;
          font-size: 14px;
          color: #111827;
          background: rgba(255, 255, 255, 0.97) no-repeat 11px center / 15px
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E");
          border: 1px solid rgba(209, 213, 219, 0.9);
          border-radius: 10px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10);
          outline: none;
        }
        .map-search input:focus {
          border-color: rgba(16, 185, 129, 0.7);
          box-shadow: 0 4px 16px rgba(16, 185, 129, 0.15), 0 0 0 3px rgba(16, 185, 129, 0.15);
        }
        .map-search input::placeholder { color: #9ca3af; }
        .map-search-results {
          list-style: none;
          margin: 6px 0 0;
          padding: 4px;
          background: rgba(255, 255, 255, 0.98);
          border: 1px solid rgba(229, 231, 235, 0.9);
          border-radius: 10px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
          max-height: min(360px, 60vh);
          overflow-y: auto;
        }
        .map-search-results li {
          padding: 8px 10px;
          border-radius: 7px;
          cursor: pointer;
        }
        .map-search-results li[aria-selected='true'] {
          background: rgba(16, 185, 129, 0.10);
        }
        .map-search-results .label {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #111827;
        }
        .map-search-results .code {
          font-weight: 500;
          color: #6b7280;
          font-variant-numeric: tabular-nums;
        }
        .map-search-results .detail {
          margin-top: 2px;
          font-size: 12px;
          color: #4b5563;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .map-search-results .empty {
          cursor: default;
          font-size: 13px;
          color: #6b7280;
        }
      `}</style>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search StoryMaps by student, district, or neighborhood"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        placeholder="Search student, CD, or neighborhood"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // After a pick the input keeps focus, so focus alone won't reopen the list.
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={listId} role="listbox" className="map-search-results">
          {results.length === 0 ? (
            <li className="empty" role="option" aria-selected="false" aria-disabled="true">
              No StoryMaps match “{query.trim()}”
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.district.cdCode}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r);
                }}
              >
                <div className="label">
                  <span>{districtLabel(r.district.cdCode)}</span>
                  <span className="code">{r.district.cdCode}</span>
                </div>
                {r.detail && <div className="detail">{r.detail}</div>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
