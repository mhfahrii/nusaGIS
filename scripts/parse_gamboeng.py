import zipfile
import xml.etree.ElementTree as ET
import json
import os

xlsx_path = r'C:/Users/ACER/.gemini/antigravity/brain/186a7c7d-0dd4-4c21-98d1-116a72c006fd/.user_uploaded/media_1795669951561_6583120b.xlsx'
zf = zipfile.ZipFile(xlsx_path)

sst = []
if 'xl/sharedStrings.xml' in zf.namelist():
    tree = ET.fromstring(zf.read('xl/sharedStrings.xml'))
    for si in tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
        sst.append(''.join(si.itertext()))

sheet_tree = ET.fromstring(zf.read('xl/worksheets/sheet1.xml'))
rows = []
for row in sheet_tree.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
    r_data = []
    for c in row.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
        t = c.get('t')
        v = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
        val = v.text if v is not None else ''
        if t == 's' and val:
            val = sst[int(val)]
        r_data.append(val)
    rows.append(r_data)

header = rows[0]
out = []
for r in rows[1:]:
    item = dict(zip(header, r))
    out.append(item)

out_path = r'c:/laragon/www/magang/scripts/gamboeng_blocks.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f'Successfully parsed {len(out)} rows to {out_path}')
