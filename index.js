// Import paket
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Sequelize, DataTypes } = require('sequelize');

// Inisialisasi Express
const app = express();
const port = 3000;

// Middleware (agar bisa baca JSON dan sajikan file statis)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 1. KONEKSI DATABASE ---
// (Gunakan info koneksi dari file lama Anda)
const sequelize = new Sequelize(
    'apikey009',       // Nama database
    'root',          // Username
    'harlan$12', // Password Anda
    {
        host: 'localhost',
        port: 3308, // Sesuaikan port jika perlu
        dialect: 'mysql'
    }
);

// --- 2. DEFINISI MODEL (TABEL) ---

// TABEL USER (first_name, last_name, email)
const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    first_name: { type: DataTypes.STRING, allowNull: false },
    last_name: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING, allowNull: false, unique: true }
});

// TABEL ADMIN (email, password)
const Admin = sequelize.define('Admin', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false } // Di aplikasi nyata, ini harus di-hash
});

// TABEL APIKEY (key, out_of_date)
const ApiKey = sequelize.define('ApiKey', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    expires_at: { // Ini implementasi 'out of date'
        type: DataTypes.DATE,
        allowNull: false
    }
    // Kolom 'userId' akan ditambah otomatis oleh relasi
});

console.log("Semua model telah didefinisikan.");

// --- 3. DEFINISI RELASI ---
// User (1) ke ApiKey (Banyak)
User.hasMany(ApiKey, { foreignKey: 'userId' });
ApiKey.belongsTo(User, { foreignKey: 'userId' });

console.log("Relasi telah diatur.");

// --- 4. RUTE (ENDPOINTS) ---

// === Rute untuk UI (Publik) ===

// Rute untuk menyajikan file index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rute untuk generate string key (untuk tombol 'Generate' di UI)
app.post('/generate-key', (req, res) => {
    const keyBytes = crypto.randomBytes(32);
    const token = keyBytes.toString('base64url');
    const stamp = Date.now().toString(36);
    const newKey = `sk-co-vi-${stamp}.${token}`;
    res.status(200).json({ apiKey: newKey });
});

// Rute untuk MENYIMPAN USER BARU (dari tombol 'Save')
// Ini adalah endpoint yang "LANGSUNG AUTO CREATE APIKEY"
app.post('/users', async (req, res) => {
    // Ambil data dari body request (yang dikirim dari UI)
    const { firstName, lastName, email, apiKey } = req.body;

    if (!firstName || !email || !apiKey) {
        return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    const t = await sequelize.transaction();
    try {
        // 1. Buat User
        const newUser = await User.create({
            first_name: firstName,
            last_name: lastName,
            email: email
        }, { transaction: t });

        // 2. Siapkan data ApiKey (expires_at = 1 tahun dari sekarang)
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        // 3. Buat ApiKey yang terhubung dengan user baru (pakai newUser.id)
        await ApiKey.create({
            key: apiKey,
            expires_at: expiryDate,
            userId: newUser.id // Ini adalah relasinya!
        }, { transaction: t });

        // 4. Selesaikan transaksi
        await t.commit();
        res.status(201).json({ message: 'User dan API Key berhasil dibuat!' });

    } catch (error) {
        await t.rollback(); // Batalkan semua jika ada error
        if (error.name === 'SequelizeUniqueConstraintError') {
             return res.status(409).json({ error: 'Email atau API Key sudah terdaftar.' });
        }
        res.status(500).json({ error: 'Gagal menyimpan ke database' });
    }
});


// === Rute untuk ADMIN ===

// (CATATAN: Ini adalah implementasi sederhana tanpa hash password atau token)
// Rute untuk Register Admin
app.post('/admin/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        // Di aplikasi nyata, 'password' HARUS di-hash dulu
        const newAdmin = await Admin.create({ email, password });
        res.status(201).json({ message: 'Admin dibuat', id: newAdmin.id });
    } catch (error) {
        res.status(500).json({ error: 'Gagal membuat admin' });
    }
});

// Rute untuk Login Admin
app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ where: { email: email } });
    
    if (!admin || admin.password !== password) {
        return res.status(401).json({ error: 'Email atau password salah' });
    }
    res.status(200).json({ message: 'Login admin berhasil' });
});

// GET: LIST USER (untuk Admin)
app.get('/admin/users', async (req, res) => {
    const users = await User.findAll();
    res.status(200).json(users);
});

// GET: LIST APIKEY (untuk Admin)
app.get('/admin/apikeys', async (req, res) => {
    const keys = await ApiKey.findAll({
        include: { model: User, attributes: ['email'] } // Sertakan email pemilik key
    });

    // Format data sesuai permintaan (key, out_of_date, status)
    const formattedKeys = keys.map(k => {
        const isInactive = new Date(k.expires_at) < new Date();
        return {
            key: k.key,
            out_of_date: k.expires_at,
            status: isInactive ? 'inactive' : 'active',
            user_email: k.User ? k.User.email : 'N/A'
        };
    });
    res.status(200).json(formattedKeys);
});

// --- 5. START SERVER ---
async function startServer() {
    try {
        await sequelize.authenticate();
        console.log('✅ Koneksi database BERHASIL.');
        
        // Sinkronisasi model (ini yang akan MEMBUAT TABEL)
        // { alter: true } akan mencocokkan tabel, lebih aman dari { force: true }
        await sequelize.sync({ alter: true }); 
        console.log('✅ Semua tabel berhasil disinkronkan.');

        // Jalankan server
        app.listen(port, () => {
            console.log(`Server berjalan di http://localhost:${port}`);
        });

    } catch (error) {
        console.error('❌ Gagal koneksi/sinkronisasi database:', error);
    }
}

// Panggil fungsi untuk memulai server
startServer();