import { writeArrayBuffer } from 'geotiff';
import fs from 'node:fs/promises';
import path from 'node:path';

async function generateSampleNdvi() {
  const width = 120;
  const height = 100;
  const values = new Float32Array(width * height);

  // Pusat koordinat kebun (Riau / Sumatra)
  const west = 101.440;
  const south = 0.735;
  const east = 101.470;
  const north = 0.760;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Pola sintetis NDVI kelapa sawit: blok kanopi tinggi (0.65 - 0.85), jalan kebun (0.15 - 0.25)
      const isRoad = x % 30 === 0 || y % 25 === 0;
      let ndviVal;
      if (isRoad) {
        ndviVal = 0.18 + Math.random() * 0.05;
      } else {
        // Kanopi sawit
        ndviVal = 0.65 + Math.sin((x / width) * Math.PI) * 0.15 + (Math.random() * 0.08 - 0.04);
      }
      values[y * width + x] = Math.max(-1, Math.min(1, ndviVal));
    }
  }

  const metadata = {
    height,
    width,
    GeoAsciiParams: 'WGS 84',
    ModelTiepoint: [0, 0, 0, west, north, 0],
    ModelPixelScale: [(east - west) / width, (north - south) / height, 0],
    GeographicTypeGeoKey: 4326,
    GDAL_NODATA: '-9999',
  };

  const arrayBuffer = await writeArrayBuffer(values, metadata);
  const buffer = Buffer.from(arrayBuffer);

  const outDir = path.resolve('uploads', 'test');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'kebun_bakalan_ndvi.tif');
  await fs.writeFile(outPath, buffer);

  console.log(`Successfully generated GeoTIFF: ${outPath} (${buffer.length} bytes)`);
  console.log(`Bounds: [${west}, ${south}, ${east}, ${north}]`);
}

generateSampleNdvi();

