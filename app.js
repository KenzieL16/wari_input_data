import express from "express";
import mysql from "mysql2";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";
import xlsx from 'xlsx';
import fs from 'fs';
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

dotenv.config(); // Menginisialisasi variabel environment

// Koneksi database 1 (source)
const dbSource = mysql.createPool({
  host: process.env.DB_HOST_1,
  user: process.env.DB_USER_1,
  password: process.env.DB_PASS_1,
  database: process.env.DB_NAME_1,
});

// Koneksi database 2 (target)
const dbTarget = mysql.createPool({
  host: process.env.DB_HOST_2,
  user: process.env.DB_USER_2,
  password: process.env.DB_PASS_2,
  database: process.env.DB_NAME_2,
});

// Fungsi untuk mendapatkan nomor urut untuk acc_doc_number
const getAccDocNumber = (yearMonth, callback) => {
  const query = `SELECT COUNT(*) as count FROM journal_headers WHERE journal_headers_id LIKE ?`;
  dbTarget.getConnection((err, connection) => {
    if (err) {
      console.error("Gagal mendapatkan koneksi ke dbTarget:", err);
      return callback(err);
    }

    connection.query(query, [`JMWKM${yearMonth}%`], (queryErr, results) => {
      connection.release();
      if (queryErr) {
        console.error("Gagal mengambil nomor urut:", queryErr);
        return callback(queryErr);
      }

      const count = results[0].count;
      const nextNumber = count + 1; // Menambah nomor urut
      callback(null, nextNumber);
    });
  });
};

// Fungsi untuk mengambil 3 data dari database 1
const bridgeData = (req, res) => {
  const now = new Date();
  const formattedDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replace(/-/g, ""); // format YYYYMMDD
    console.log('Data Tanggal : ',formattedDate);
  const query = `
    SELECT twf.nm_customer11, twf.no_msn, twf.kd_card, twf.tgl_bayar_renewal_fin, 
           mc.jns_card, mc.harga_pokok, mc.asuransi, mc.asuransi_motor
    FROM tr_wms_faktur3 twf
    JOIN mst_card mc ON twf.kd_card = mc.kd_card
    WHERE twf.sts_renewal = 'O' 
    AND twf.tgl_bayar_renewal_fin_key_in = '${formattedDate}'
  `;

  //AND twf.tgl_bayar_renewal_fin_key_in = '${formattedDate}'
  //AND twf.tgl_bayar_renewal_fin_key_in = '20240920' 
  // Eksekusi query
  dbSource.getConnection((err, connection) => {
    if (err) {
      console.error("Gagal mendapatkan koneksi ke dbSource:", err);
      return;
    }

    connection.query(query, [formattedDate], (queryErr, results) => {
      connection.release();
      if (queryErr) {
        console.error("Gagal mengambil data dari source:", queryErr);
        return;
      }

    // Memeriksa apakah ada data yang diambil
    if (results.length > 0) {
      // Mendapatkan tahun dan bulan saat ini
      console.log("Data ditemukan dari source, melanjutkan proses insert...");
      const now = new Date();
      const yearMonth = `${now.getFullYear().toString().slice(-2)}${String(
        now.getMonth() + 1
      ).padStart(2, "0")}`; // Format YYMM

      // Mengonversi data dan format tanggal
      const dataToInsert = results.map((row) => {
        const formattedDate = new Date(row.tgl_bayar_renewal_fin + "Z")
          .toISOString()
          .split("T")[0]; // Adjusted for timezone
        const now = new Date();
        const verifiedDate = now.toISOString().split("T")[0];
        const amount =
          parseFloat(row.harga_pokok) +
          parseFloat(row.asuransi) +
          parseFloat(row.asuransi_motor);
        const description = `HVC ${row.nm_customer11} ${row.no_msn}`;
        const descriptionDetails = `HVC ${row.jns_card} ${row.nm_customer11}`;
        const mainId = uuidv4();
        const harga_product = parseFloat((row.harga_pokok / 1.11).toFixed(2));
        function roundToNearestEven(number) {
          // console.log(number);
          
          // Pisahkan angka menjadi bagian desimal
          var decimalPart = (number + '').split('.')[1];
        
          // Jika tidak ada desimal, langsung kembalikan angka
          if (!decimalPart) return number;
        
          // Ambil dua digit pertama setelah titik desimal
          var firstTwoDigits = decimalPart.substring(0, 2);
          
          // Konversikan digit pertama dan kedua
          var firstDigit = parseInt(firstTwoDigits[0]);
          var secondDigit = firstTwoDigits.length > 1 ? parseInt(firstTwoDigits[1]) : 0;
          
          // console.log('digit Pertama : ', firstDigit);
          // console.log('digit Kedua : ', secondDigit);
        
          // Jika angka desimal adalah tepat 0.5
          if (firstDigit === 5 && secondDigit === 0) {
            // Lihat apakah bilangan bulat terdekat adalah genap
            var rounded = Math.floor(number); // Pembulatan ke bawah
            if (rounded % 2 === 0) {
              return rounded; // Sudah genap
            } else {
              return rounded + 1; // Tambahkan 1 jika ganjil
            }
          } else {
            // Gunakan pembulatan normal jika bukan 0.5
            return Math.round(number);
          }
        }
        
        
        const detail = [
          {
            id: uuidv4(),
            accvch_id: mainId,
            coa_id: "211.09.01",
            description: descriptionDetails,
            cost_center_id: "",
            db_cr: "CR",
            amount: roundToNearestEven(harga_product * 0.11),
            source_doc: null,
            branch_id: "65e6d206-eebc-4e50-ba1f-23f4c0a84611",
            branch_code: "PUSAT",
            fsubsidiary: null,
            created: verifiedDate,
            create_by: 1546,
            modified: verifiedDate,
            modi_by: 1546,
            kunci: null,
          },
          {
            id: uuidv4(),
            accvch_id: mainId,
            coa_id: "211.07.02",
            description: descriptionDetails,
            cost_center_id: "",
            db_cr: "CR",
            amount: Math.round(parseFloat(row.asuransi)),
            source_doc: null,
            branch_id: "65e6d206-eebc-4e50-ba1f-23f4c0a84611",
            branch_code: "PUSAT",
            fsubsidiary: null,
            created: verifiedDate,
            create_by: 1546,
            modified: verifiedDate,
            modi_by: 1546,
            kunci: null,
          },
          {
            id: uuidv4(),
            accvch_id: mainId,
            coa_id: "311.03",
            description: descriptionDetails,
            cost_center_id: "",
            db_cr: "CR",
            amount: Math.round(harga_product),
            source_doc: null,
            branch_id: "65e6d206-eebc-4e50-ba1f-23f4c0a84611",
            branch_code: "PUSAT",
            fsubsidiary: null,
            created: verifiedDate,
            create_by: 1546,
            modified: verifiedDate,
            modi_by: 1546,
            kunci: null,
          },
          {
            id: uuidv4(),
            accvch_id: mainId, // Placeholder untuk relasi dengan accvouchers
            coa_id: "116.06",
            description: descriptionDetails,
            cost_center_id: "", // Masukkan cost center ID sesuai kebutuhan
            db_cr: "DB", // Atur sesuai kebutuhan (D untuk debit, C untuk kredit)
            amount: amount,
            source_doc: null, // Masukkan source document sesuai kebutuhan
            branch_id: "65e6d206-eebc-4e50-ba1f-23f4c0a84611",
            branch_code: "PUSAT", // Masukkan kode branch sesuai kebutuhan
            fsubsidiary: null, // Masukkan subsidiary sesuai kebutuhan
            created: verifiedDate,
            create_by: 1546,
            modified: verifiedDate,
            modi_by: 1546,
            kunci: null,
          },
        ];

        if (parseFloat(row.asuransi_motor) !== 0) {
          detail.push({
            id: uuidv4(),
            accvch_id: mainId,
            coa_id: "211.07.03",
            description: descriptionDetails,
            cost_center_id: "",
            db_cr: "CR",
            amount: parseFloat(row.asuransi_motor),
            source_doc: null,
            branch_id: "65e6d206-eebc-4e50-ba1f-23f4c0a84611",
            branch_code: "PUSAT",
            fsubsidiary: null,
            created: verifiedDate,
            create_by: 1546,
            modified: verifiedDate,
            modi_by: 1546,
            kunci: null,
          });
        }

        return {
          id: mainId,
          acc_doc_number: "",
          verified_date: verifiedDate,
          date_voucher: null, // Biarkan null
          finvch_id: null, // Biarkan null
          doc_number: "",
          transaction_date: formattedDate,
          cash_bank_id: "JUAL",
          coa_id: null,
          jn_type: "M",
          rp_type: null,
          db_cr: null,
          amount: amount,
          giro_number: null,
          giro_due_date: null,
          is_deleted: 0,
          is_unpost: null,
          paid_to_from: null,
          description: description,
          ncetak: 0,
          branch_id: "65e6d206-eebc-4e50-ba1f-23f4c0a84611",
          branch_code: "PUSAT",
          region_id: null,
          amount_check: amount,
          created: verifiedDate,
          create_by: 1546,
          modified: verifiedDate,
          modi_by: 1546,
          kunci: null,
          detail: detail,
        };
      });

      // Mendapatkan nomor urut untuk acc_doc_number dari database target
      getAccDocNumber(yearMonth, (err, nextNumber) => {
        if (err) {
          console.log("Gagal mendapatkan nomor urut");
        }

        // Mengisi acc_doc_number untuk setiap data yang diambil
        dataToInsert.forEach((item, index) => {
          // console.log(`Detail untuk item ${index + 1}:`, item.detail);
          const accDocNumber = `JMWKM${yearMonth}${String(
            nextNumber + index
          ).padStart(5, "0")}`;
          item.acc_doc_number = accDocNumber;
          item.doc_number = accDocNumber;
          insertAccVoucher(item, (err) => {
            if (err) {
              console.log("Gagal memasukkan data ke accvouchers");
              return;
            }
            item.detail.forEach(detail => {
              detail.accvch_id = item.id; // Gunakan item.id yang merupakan mainId untuk setiap detail
            });
            // Insert detail ke tabel accvoucher_details
            insertAccVoucherDetails(item.detail, (err) => {
              if (err) {
                console.log("Gagal memasukkan data ke accvoucher_details");
              }
            });
          });
        });
        // Menampilkan data yang diambil
        // res.json(dataToInsert);
        console.log('Berhasil Input Data');
      });
    } else {
      console.log("Tidak ada data yang ditemukan");
      // res.send("Tidak ada data yang ditemukan");
    }
  });
});

const insertAccVoucher = (data, callback) => {
  const query = `
    INSERT INTO journal_headers (id, journal_headers_id, transaction_date, amount, 
    description, tipe_trn, branch_id, created, create_by, modified, modi_by) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  dbTarget.getConnection((err, connection) => {
    if (err) {
      console.error("Gagal mendapatkan koneksi ke dbTarget:", err);
      return callback(err);
    }

    connection.query(
      query,
      [
        data.id,
        data.acc_doc_number,
        data.transaction_date,
        data.amount,
        data.description,
        data.cash_bank_id,
        data.branch_id,
        data.created,
        data.create_by,
        data.modified,
        data.modi_by,
      ],
      (queryErr, result) => {
        connection.release(); // Lepaskan koneksi kembali ke pool
        if (queryErr) {
          console.error("Gagal memasukkan data ke Journal Header:", queryErr);
          return callback(queryErr);
        }
        callback(null, result);
      }
    );
  });
  }
};

// Fungsi untuk memasukkan detail ke tabel accvoucher_details
const insertAccVoucherDetails = (details, callback) => {
  const query = `
    INSERT INTO journal_details (id, journal_header_id, cost_center_id, coa_id, description, acc_dbcr, amount, 
    paid_to, branch_id, branch_code, coa_lawan, created, create_by, modified, modi_by) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  // Gunakan Promise.all untuk menunggu semua query selesai
  dbTarget.getConnection((err, connection) => {
    if (err) {
      console.error("Gagal mendapatkan koneksi ke dbTarget:", err);
      return callback(err);
    }

    const promises = details.map((detail, index) => {
      return new Promise((resolve, reject) => {
        connection.query(
          query,
          [
            detail.id,
            detail.accvch_id,
            detail.cost_center_id,
            detail.coa_id,
            detail.description,
            detail.db_cr,
            detail.amount,
            detail.source_doc,
            detail.branch_id,
            detail.branch_code,
            detail.fsubsidiary,
            detail.created,
            detail.create_by,
            detail.modified,
            detail.modi_by,
          ],
          (queryErr) => {
            if (queryErr) {
              console.error(
                `Gagal memasukkan detail ke journal_details (row ${index + 1}):`,
                queryErr
              );
              reject(queryErr);
            } else {
              resolve();
            }
          }
        );
      });
    });

    // Tunggu sampai semua promises selesai
    Promise.all(promises)
      .then(() => {
        connection.release(); // Lepaskan koneksi setelah semua selesai
        callback(null); // Semua detail berhasil dimasukkan
      })
      .catch((err) => {
        connection.release(); // Lepaskan koneksi jika ada error
        callback(err); // Terjadi error
      });
  });
};

app.get('/generate-uuids-excel', (req, res) => {
  // Menghasilkan 146 UUID
  const uuids = Array.from({ length: 151 }, () => uuidv4());

  // Membuat workbook dan worksheet
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(uuids.map(uuid => [uuid])); // Konversi UUID ke array untuk satu kolom

  // Menambahkan worksheet ke workbook
  xlsx.utils.book_append_sheet(wb, ws, 'UUIDs');

  // Menyimpan file Excel secara sementara
  const filePath = './uuids.xlsx';
  xlsx.writeFile(wb, filePath);

  // Mengirimkan file sebagai respons untuk di-download
  res.download(filePath, 'uuids.xlsx', (err) => {
      if (err) {
          console.error('Error saat mengirim file:', err);
      } else {
          // Menghapus file setelah di-download
          fs.unlinkSync(filePath);
      }
  });
});

function getPreviousMonth() {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);  // Set ke bulan sebelumnya
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');  // Bulan dalam dua digit
  return `${year}-${month}`;
}
async function runClosingGL(periode) {
  try {
    // Menjalankan prosedur dengan periode bulan sebelumnya
    dbTarget.query(`CALL sp_ClosingGLNewest('${periode}')`);
    
    console.log(`Prosedur sp_ClosingGLNewest berhasil dijalankan untuk periode: ${periode}`);
    
    // Tutup koneksi
    await connection.end();
  } catch (error) {
    console.log(`Error saat menjalankan sp_ClosingGLNewest: ${error.message}`);
  }
}

app.post('/run-closing', async (req, res) => {
  const periode = req.body.periode || getPreviousMonth(); // Gunakan periode dari request atau default ke bulan sebelumnya

  try {
    await runClosingGL(periode);
    res.status(200).json({ message: `Prosedur sp_ClosingGLNewest berhasil dijalankan untuk periode: ${periode}` });
  } catch (error) {
    res.status(500).json({ error: `Error saat menjalankan sp_ClosingGLNewest: ${error.message}` });
  }
});

// bridgeData(); 
//==================Fixed=====================
// cron.schedule('0 20 * * *', () => {
//   console.log('Setiap Jam 8 Malam');
//   bridgeData(); // panggil fungsi untuk menjalankan query
// });

// ==================Ini Untuk Testing=====================
// cron.schedule('*/10 * * * * *', () => {
//   console.log('Setiap 5 Detik');
//   bridgeData(); // panggil fungsi untuk menjalankan query
// });

//==================Ini Untuk Closing=====================
// cron.schedule('0 1 15 * *', () => {
//   const periode = getPreviousMonth();
//   runClosingGL(periode);
// });

// Menjalankan server
app.listen(3000, () => {
  console.log("Server berjalan di port 3000");
});
