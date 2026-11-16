import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'nusagis',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ambil atau buat Kebun Inti
    let kebunId;
    const kebunRes = await client.query("SELECT id FROM kebun WHERE kode_kebun = 'KBN-INTI' LIMIT 1;");
    if (kebunRes.rowCount > 0) {
      kebunId = kebunRes.rows[0].id;
    } else {
      const insK = await client.query(`
        INSERT INTO kebun (kode_kebun, nama_kebun, wilayah, komoditas, keterangan)
        VALUES ('KBN-INTI', 'Kebun Sawit Inti Riau', 'Kampar, Riau', 'Kelapa Sawit', 'Kebun Inti Percontohan')
        RETURNING id;
      `);
      kebunId = insK.rows[0].id;
    }

    // 2. Buat Afdeling
    await client.query('DELETE FROM blok;');
    await client.query('DELETE FROM afdeling;');

    const insAfd1 = await client.query(`
      INSERT INTO afdeling (kebun_id, kode_afdeling, nama_afdeling, keterangan)
      VALUES ($1, 'AFD-01', 'Afdeling 1', 'Afdeling Utara')
      RETURNING id;
    `, [kebunId]);
    const afd1Id = insAfd1.rows[0].id;

    const insAfd2 = await client.query(`
      INSERT INTO afdeling (kebun_id, kode_afdeling, nama_afdeling, keterangan)
      VALUES ($1, 'AFD-02', 'Afdeling 2', 'Afdeling Selatan')
      RETURNING id;
    `, [kebunId]);
    const afd2Id = insAfd2.rows[0].id;

    // 3. Buat Blok
    await client.query(`
      INSERT INTO blok (afdeling_id, kode_blok, nama_blok, komoditas, tahun_tanam, keterangan)
      VALUES 
        ($1, 'A01', 'Blok A01', 'Kelapa Sawit', 2018, 'Produksi TM-1'),
        ($1, 'A02', 'Blok A02', 'Kelapa Sawit', 2018, 'Produksi TM-1'),
        ($1, 'A03', 'Blok A03', 'Kelapa Sawit', 2019, 'Produksi TBM-3'),
        ($2, 'B01', 'Blok B01', 'Kelapa Sawit', 2020, 'Produksi TBM-2');
    `, [afd1Id, afd2Id]);

    // 4. Bersihkan layer_peta lama & fitur_peta untuk reset terstruktur
    await client.query('DELETE FROM fitur_peta;');
    await client.query('DELETE FROM layer_peta;');

    // Buat data_unggahan referensi
    const uploadRes = await client.query(`
      INSERT INTO data_unggahan (
        pengguna_id, kebun_id, nama_data, nama_file, format_file,
        lokasi_file, status, jumlah_layer
      ) VALUES (
        (SELECT id FROM pengguna LIMIT 1),
        $1,
        'Master Geodatabase Perkebunan',
        'master_plantation_layers.zip',
        'ZIP',
        'uploads/gis/master_plantation_layers.zip',
        'berhasil',
        4
      )
      RETURNING id;
    `, [kebunId]);
    const uploadId = uploadRes.rows[0].id;

    // LAYER 1: Batas Kebun
    const layerKebun = await client.query(`
      INSERT INTO layer_peta (
        unggahan_id, kebun_id, nama_layer, nama_file_shp, tipe_geometri,
        warna, transparansi, terlihat, urutan, jumlah_fitur
      ) VALUES (
        $1, $2, 'Batas Kebun', 'batas_kebun.shp', 'Polygon',
        '#a855f7', 0.15, true, 1, 1
      ) RETURNING id;
    `, [uploadId, kebunId]);
    const layerKebunId = layerKebun.rows[0].id;

    // Geometri Batas Kebun (Polygon menyeluruh)
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerKebunId,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [[
          [101.435, 0.725],
          [101.475, 0.725],
          [101.475, 0.765],
          [101.435, 0.765],
          [101.435, 0.725]
        ]]
      }),
      JSON.stringify({
        OBJECTID: 1,
        Kode_Kebun: 'KBN-INTI',
        Nama_Kebun: 'Kebun Sawit Inti Riau',
        Wilayah: 'Kampar, Riau',
        Komoditas: 'Kelapa Sawit',
        'Luas (Ha)': 350.25,
      })
    ]);

    // LAYER 2: Batas Afdeling
    const layerAfd = await client.query(`
      INSERT INTO layer_peta (
        unggahan_id, kebun_id, nama_layer, nama_file_shp, tipe_geometri,
        warna, transparansi, terlihat, urutan, jumlah_fitur
      ) VALUES (
        $1, $2, 'Batas Afdeling', 'batas_afdeling.shp', 'Polygon',
        '#3b82f6', 0.20, true, 2, 2
      ) RETURNING id;
    `, [uploadId, kebunId]);
    const layerAfdId = layerAfd.rows[0].id;

    // Afdeling 1
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerAfdId,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [[
          [101.436, 0.745],
          [101.474, 0.745],
          [101.474, 0.764],
          [101.436, 0.764],
          [101.436, 0.745]
        ]]
      }),
      JSON.stringify({
        OBJECTID: 1,
        'Kode Afdeling': 'AFD-01',
        'Nama Afdeling': 'Afdeling 1',
        Kebun: 'Kebun Sawit Inti Riau',
        'Luas (Ha)': 180.50,
      })
    ]);

    // Afdeling 2
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerAfdId,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [[
          [101.436, 0.726],
          [101.474, 0.726],
          [101.474, 0.744],
          [101.436, 0.744],
          [101.436, 0.726]
        ]]
      }),
      JSON.stringify({
        OBJECTID: 2,
        'Kode Afdeling': 'AFD-02',
        'Nama Afdeling': 'Afdeling 2',
        Kebun: 'Kebun Sawit Inti Riau',
        'Luas (Ha)': 169.75,
      })
    ]);

    // LAYER 3: Batas Blok (Persis seperti di mockup: OBJECTID, Kode Blok, Afdeling, Luas (Ha))
    const layerBlok = await client.query(`
      INSERT INTO layer_peta (
        unggahan_id, kebun_id, nama_layer, nama_file_shp, tipe_geometri,
        warna, transparansi, terlihat, urutan, jumlah_fitur
      ) VALUES (
        $1, $2, 'Batas Blok', 'batas_blok.shp', 'Polygon',
        '#10b981', 0.35, true, 3, 3
      ) RETURNING id;
    `, [uploadId, kebunId]);
    const layerBlokId = layerBlok.rows[0].id;

    // Blok A01 (25.60 Ha)
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerBlokId,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [[
          [101.440, 0.748],
          [101.455, 0.748],
          [101.455, 0.758],
          [101.440, 0.758],
          [101.440, 0.748]
        ]]
      }),
      JSON.stringify({
        OBJECTID: 1,
        'Kode Blok': 'A01',
        Afdeling: 'Afdeling 1',
        'Luas (Ha)': 25.60,
        Komoditas: 'Kelapa Sawit',
        'Tahun Tanam': 2018,
      })
    ]);

    // Blok A02 (21.40 Ha)
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerBlokId,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [[
          [101.456, 0.748],
          [101.470, 0.748],
          [101.470, 0.758],
          [101.456, 0.758],
          [101.456, 0.748]
        ]]
      }),
      JSON.stringify({
        OBJECTID: 2,
        'Kode Blok': 'A02',
        Afdeling: 'Afdeling 1',
        'Luas (Ha)': 21.40,
        Komoditas: 'Kelapa Sawit',
        'Tahun Tanam': 2018,
      })
    ]);

    // Blok A03 (28.15 Ha)
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerBlokId,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [[
          [101.440, 0.735],
          [101.455, 0.735],
          [101.455, 0.746],
          [101.440, 0.746],
          [101.440, 0.735]
        ]]
      }),
      JSON.stringify({
        OBJECTID: 3,
        'Kode Blok': 'A03',
        Afdeling: 'Afdeling 1',
        'Luas (Ha)': 28.15,
        Komoditas: 'Kelapa Sawit',
        'Tahun Tanam': 2019,
      })
    ]);

    // LAYER 4: Jalan Kebun
    const layerJalan = await client.query(`
      INSERT INTO layer_peta (
        unggahan_id, kebun_id, nama_layer, nama_file_shp, tipe_geometri,
        warna, transparansi, terlihat, urutan, jumlah_fitur
      ) VALUES (
        $1, $2, 'Jalan Kebun', 'jalan_kebun.shp', 'LineString',
        '#f59e0b', 0.9, true, 4, 3
      ) RETURNING id;
    `, [uploadId, kebunId]);
    const layerJalanId = layerJalan.rows[0].id;

    // Jalan Poros Utama
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerJalanId,
      JSON.stringify({
        type: 'LineString',
        coordinates: [
          [101.436, 0.747],
          [101.455, 0.747],
          [101.472, 0.747]
        ]
      }),
      JSON.stringify({
        OBJECTID: 1,
        'Nama Jalan': 'Jalan Poros Utama',
        Tipe: 'Main Road',
        'Lebar (m)': 8,
        'Panjang (m)': 4000,
      })
    ]);

    // Jalan Koleksi Blok A01
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerJalanId,
      JSON.stringify({
        type: 'LineString',
        coordinates: [
          [101.440, 0.747],
          [101.440, 0.758]
        ]
      }),
      JSON.stringify({
        OBJECTID: 2,
        'Nama Jalan': 'Jalan Koleksi A01',
        Tipe: 'Collection Road',
        'Lebar (m)': 5,
        'Panjang (m)': 1220,
      })
    ]);

    // Jalan Koleksi Blok A02
    await client.query(`
      INSERT INTO fitur_peta (layer_id, geom, atribut)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_GeomFromGeoJSON($2)), 4326),
        $3
      );
    `, [
      layerJalanId,
      JSON.stringify({
        type: 'LineString',
        coordinates: [
          [101.456, 0.747],
          [101.456, 0.758]
        ]
      }),
      JSON.stringify({
        OBJECTID: 3,
        'Nama Jalan': 'Jalan Koleksi A02',
        Tipe: 'Collection Road',
        'Lebar (m)': 5,
        'Panjang (m)': 1220,
      })
    ]);

    await client.query('COMMIT');
    console.log('SUCCESS: Master plantation layers created successfully!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERROR SEEDING:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
