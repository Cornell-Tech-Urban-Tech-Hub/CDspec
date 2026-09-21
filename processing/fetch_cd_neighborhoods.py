"""Build processing/cd_neighborhoods.json: neighborhood names per community district.

Source: NYC 2020 Neighborhood Tabulation Areas (NYC Open Data, 9nt8-h7nd).
Each NTA carries the code of the Community District Tabulation Area it sits
in (e.g. "BK05"), which maps onto the boro_cd codes the map uses ("305").
CDTA codes above 18 are joint interest areas (large parks, airports) that
belong to no district, so they are skipped.

Usage: python3 processing/fetch_cd_neighborhoods.py
"""

import json
import urllib.request
from pathlib import Path

URL = (
    'https://data.cityofnewyork.us/resource/9nt8-h7nd.json'
    '?$select=ntaname,cdta2020&$limit=1000'
)
BORO_DIGIT = {'MN': '1', 'BX': '2', 'BK': '3', 'QN': '4', 'SI': '5'}
OUTPUT = Path(__file__).parent / 'cd_neighborhoods.json'


def main():
    with urllib.request.urlopen(URL) as res:
        rows = json.load(res)

    by_cd = {}
    for row in rows:
        cdta = row['cdta2020']
        district = int(cdta[2:])
        if district > 18:
            continue
        cd = BORO_DIGIT[cdta[:2]] + f'{district:02d}'
        by_cd.setdefault(cd, []).append(row['ntaname'])

    out = {cd: sorted(set(names)) for cd, names in sorted(by_cd.items())}
    OUTPUT.write_text(json.dumps(out, indent=2) + '\n')
    print(f'{len(out)} districts, {sum(map(len, out.values()))} neighborhoods -> {OUTPUT}')


if __name__ == '__main__':
    main()
