import fs from 'node:fs/promises';
import path from 'node:path';
import { fromArrayBuffer } from 'geotiff';
import { PNG } from 'pngjs';

// Color ramp for NDVI
function getNdviColor(val, minVal, maxVal) {
  const norm = Math.max(0, Math.min(1, (val - minVal) / (maxVal - minVal || 1)));
  if (norm < 0.2) return [220, 38, 38, 240];
  if (norm < 0.4) return [249, 115, 22, 240];
  if (norm < 0.6) return [250, 204, 21, 240];
  if (norm < 0.8) return [132, 204, 22, 240];
  return [21, 128, 61, 245];
}

async function testPipeline() {
  const filePath = path.resolve('uploads', 'test', 'kebun_bakalan_ndvi.tif');
  const fileBuffer = await fs.readFile(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);

  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();

  const width = image.getWidth();
  const height = image.getHeight();
  const bandsCount = image.getSamplesPerPixel();
  const bbox = image.getBoundingBox();

  console.log('1. Metadata:', { width, height, bandsCount, bbox });

  const rasters = await image.readRasters();
  const band = rasters[0];
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < band.length; i++) {
    if (band[i] < min) min = band[i];
    if (band[i] > max) max = band[i];
  }
  console.log(`Min: ${min.toFixed(4)}, Max: ${max.toFixed(4)}`);

  console.log('2. Rendering PNG overlay...');
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pngIdx = idx * 4;
      const v = band[idx];
      const [r, g, b, a] = getNdviColor(v, min, max);
      png.data[pngIdx] = r;
      png.data[pngIdx + 1] = g;
      png.data[pngIdx + 2] = b;
      png.data[pngIdx + 3] = a;
    }
  }
  const pngBuffer = PNG.sync.write(png);
  console.log(`Generated PNG size: ${pngBuffer.length} bytes`);
  await fs.writeFile(path.resolve('uploads', 'test', 'kebun_bakalan_ndvi.png'), pngBuffer);

  console.log('3. Inspecting pixel at center (101.455, 0.748)...');
  const [minX, minY, maxX, maxY] = bbox;
  const targetLng = 101.455, targetLat = 0.748;
  const px = Math.floor(((targetLng - minX) / (maxX - minX)) * width);
  const py = Math.floor(((maxY - targetLat) / (maxY - minY)) * height);
  const val = band[py * width + px];
  console.log(`Coordinate (${targetLng}, ${targetLat}) -> Pixel [${px}, ${py}] = NDVI ${val.toFixed(4)}`);
}

testPipeline();

