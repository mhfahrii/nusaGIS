import assert from 'node:assert';
import zlib from 'node:zlib';
import path from 'node:path';

// Salin fungsi createZipBuffer dan bundleLooseFilesToZip untuk pengujian unit
function createZipBuffer(files) {
  const localHeaders = [];
  const cdHeaders = [];
  let offset = 0;

  for (const f of files) {
    const cleanName = path.posix.basename(f.name.replace(/\\/g, '/'));
    const nameBuf = Buffer.from(cleanName, 'utf8');
    const crc = zlib.crc32(f.buffer);

    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.buffer.length, 18);
    lh.writeUInt32LE(f.buffer.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBuf.copy(lh, 30);
    localHeaders.push(lh, f.buffer);

    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(f.buffer.length, 20);
    cdh.writeUInt32LE(f.buffer.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    nameBuf.copy(cdh, 46);
    cdHeaders.push(cdh);

    offset += lh.length + f.buffer.length;
  }

  const cdOffset = offset;
  const cdSize = cdHeaders.reduce((sum, h) => sum + h.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

function bundleLooseFilesToZip(files) {
  const shpFiles = files.filter((f) => f.name.toLowerCase().endsWith('.shp'));
  if (shpFiles.length === 0) {
    throw new Error('NO_SHP_FOUND');
  }
  const primaryName = path.basename(shpFiles[0].name, path.extname(shpFiles[0].name));
  const zipBuffer = createZipBuffer(files);
  return {
    zipBuffer,
    primaryName,
    shpCount: shpFiles.length,
  };
}

async function run() {
  console.log('--- TEST 1: Bundling 8 File Esri Shapefile Component Suite (Folder Kebun Bakalan) ---');

  const files = [
    { name: 'Kebun Bakalan_v1.cpg', buffer: Buffer.from('UTF-8') },
    { name: 'Kebun Bakalan_v1.dbf', buffer: Buffer.from('test-dbf-data') },
    { name: 'Kebun Bakalan_v1.prj', buffer: Buffer.from('GEOGCS["WGS 84"...]') },
    { name: 'Kebun Bakalan_v1.sbn', buffer: Buffer.from([1, 2, 3]) },
    { name: 'Kebun Bakalan_v1.sbx', buffer: Buffer.from([4, 5, 6]) },
    { name: 'Kebun Bakalan_v1.shp', buffer: Buffer.from('test-shp-geometry') },
    { name: 'Kebun Bakalan_v1.shp.xml', buffer: Buffer.from('<xml></xml>') },
    { name: 'Kebun Bakalan_v1.shx', buffer: Buffer.from('test-shx-index') },
  ];

  const res = bundleLooseFilesToZip(files);
  console.log('✓ Primary name terdeteksi:', res.primaryName);
  console.log('✓ Jumlah file .shp:', res.shpCount);
  console.log('✓ Ukuran ZIP terbundle:', res.zipBuffer.length, 'bytes');

  assert.strictEqual(res.primaryName, 'Kebun Bakalan_v1');
  assert.strictEqual(res.shpCount, 1);
  assert(res.zipBuffer.length > 0);

  console.log('\n--- TEST 2: Memverifikasi Struktur Binary ZIP ---');
  assert.strictEqual(res.zipBuffer.readUInt32LE(0), 0x04034b50, 'Magic bytes ZIP harus PK\x03\x04');

  // Cari EOCD
  let eocdOffset = -1;
  for (let i = res.zipBuffer.length - 22; i >= 0; i--) {
    if (res.zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert(eocdOffset >= 0, 'EOCD ZIP signature harus ditemukan');
  const count = res.zipBuffer.readUInt16LE(eocdOffset + 10);
  assert.strictEqual(count, 8, 'Harus ada 8 entry di dalam ZIP');
  console.log(`✓ Total entry di dalam arsip ZIP: ${count} file lengkap`);

  console.log('\n=== PENGUJIAN SELESAI DENGAN SUKSES ===');
}

run();
