import fs from 'node:fs/promises';
import path from 'node:path';
import { parseGeoTiffMetadata, renderGeoTiffToPng, inspectPixelAtCoordinate } from '../src/lib/gis/geotiff.ts';

async function testPipeline() {
  const filePath = path.resolve('uploads', 'test', 'kebun_bakalan_ndvi.tif');
  const buffer = await fs.readFile(filePath);

  console.log('1. Testing parseGeoTiffMetadata...');
  const meta = await parseGeoTiffMetadata(buffer);
  console.log('Metadata result:', meta);

  console.log('\n2. Testing renderGeoTiffToPng...');
  const pngBuf = await renderGeoTiffToPng(filePath, 256);
  console.log(`Rendered PNG size: ${pngBuf.length} bytes`);
  await fs.writeFile(path.resolve('uploads', 'test', 'kebun_bakalan_ndvi.png'), pngBuf);
  console.log('Saved rendered PNG overlay to uploads/test/kebun_bakalan_ndvi.png');

  console.log('\n3. Testing inspectPixelAtCoordinate inside kebun (101.455, 0.748)...');
  const inspect1 = await inspectPixelAtCoordinate(filePath, 101.455, 0.748);
  console.log('Inspect inside:', inspect1);

  console.log('\n4. Testing inspectPixelAtCoordinate outside kebun (105.0, 2.0)...');
  const inspect2 = await inspectPixelAtCoordinate(filePath, 105.0, 2.0);
  console.log('Inspect outside:', inspect2);
}

testPipeline();

