import { useState } from "react";
import "./App.css";

const menus = [
  { id: "dashboard", label: "Dashboard" },
  { id: "cashier", label: "Kasir" },
  { id: "products", label: "Produk" },
  { id: "inventory", label: "Stok" },
  { id: "transactions", label: "Riwayat" },
  { id: "reports", label: "Laporan" },
  { id: "settings", label: "Pengaturan" },
];

function App() {
  const [activePage, setActivePage] = useState("cashier");

  const activeMenu = menus.find((menu) => menu.id === activePage);
  const pageTitle = activeMenu ? activeMenu.label : "Kasir";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">TTM</div>
          <div>
            <h1>Toko Telon Mindi</h1>
            <p>POS v2</p>
          </div>
        </div>

        <nav className="menu-list">
          {menus.map((menu) => (
            <button
              key={menu.id}
              type="button"
              className={activePage === menu.id ? "menu-item active" : "menu-item"}
              onClick={() => setActivePage(menu.id)}
            >
              {menu.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">POS Toko</p>
            <h2>{pageTitle}</h2>
          </div>

          <div className="status-pill">Development</div>
        </header>

        <section className="page-card">
          {activePage === "dashboard" ? <DashboardPage /> : null}
          {activePage === "cashier" ? <CashierPage /> : null}
          {activePage === "products" ? <ProductsPage /> : null}
          {activePage === "inventory" ? <InventoryPage /> : null}
          {activePage === "transactions" ? <TransactionsPage /> : null}
          {activePage === "reports" ? <ReportsPage /> : null}
          {activePage === "settings" ? <SettingsPage /> : null}
        </section>
      </main>
    </div>
  );
}

function DashboardPage() {
  return (
    <div className="empty-page">
      <h3>Dashboard</h3>
      <p>Ringkasan omzet, profit, transaksi, dan produk terlaris nanti muncul di sini.</p>
    </div>
  );
}

function CashierPage() {
  return (
    <div>
      <h3>Kasir</h3>
      <p className="muted">
        Ini halaman utama yang nanti dipakai untuk transaksi toko.
      </p>

      <div className="cashier-layout">
        <div className="product-area">
          <h4>Daftar Produk</h4>
          <p>
            Search produk, kategori, dan grid produk akan kita buat di tahap berikutnya.
          </p>
        </div>

        <div className="cart-area">
          <h4>Keranjang</h4>
          <p>
            Item belanja, total, bayar, dan kembalian akan muncul di sini.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProductsPage() {
  return (
    <div className="empty-page">
      <h3>Produk</h3>
      <p>Tambah, edit, hapus, kategori, harga jual, harga modal, dan varian produk.</p>
    </div>
  );
}

function InventoryPage() {
  return (
    <div className="empty-page">
      <h3>Stok</h3>
      <p>Manajemen stok sederhana dan FIFO nanti kita susun di sini.</p>
    </div>
  );
}

function TransactionsPage() {
  return (
    <div className="empty-page">
      <h3>Riwayat</h3>
      <p>Semua transaksi, detail transaksi, dan cetak ulang struk.</p>
    </div>
  );
}

function ReportsPage() {
  return (
    <div className="empty-page">
      <h3>Laporan</h3>
      <p>Laporan harian, mingguan, bulanan, tahunan, omzet, profit, dan produk terjual.</p>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="empty-page">
      <h3>Pengaturan</h3>
      <p>Nama toko, alamat, nomor WhatsApp, catatan struk, dan pengaturan kasir.</p>
    </div>
  );
}

export default App;